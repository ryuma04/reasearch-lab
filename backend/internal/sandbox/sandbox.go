// Package sandbox runs agent-written and researcher-edited code in a fresh, locked-down Docker
// container per execution (Docker SDK for Go), and turns results/metrics.json into validated,
// proof-linked metrics (Hero 2: no number without proof).
//
// Safety rules (allaboutourproject.md 16.2): CPU/memory/process/time limits enforced by Docker,
// network only in the install phase, non-root user, all capabilities dropped, no-new-privileges,
// read-only root filesystem, the project mounted read-only with only results/, models/, data/
// and caches writable, the workspace uploads read-only, never the Docker socket.
package sandbox

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	units "github.com/docker/go-units"

	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

const (
	logTailSize = 12 << 10
	// maxLogBytes stops a print loop from filling the disk.
	maxLogBytes = 50 << 20
	verifyTimeout = 3 * time.Minute
)

type Service struct {
	cfg    *config.Config
	store  *store.Store
	bus    *bus.Bus
	engine *Engine
	gitMu  sync.Mutex

	mu       sync.Mutex
	base     context.Context // server lifetime: shutdown kills running containers
	active   map[int64]*activeExec
	runLocks map[int64]chan struct{}

	limitsMu    sync.Mutex
	limitsKnown bool
	limits      Limits
}

type activeExec struct {
	runID  int64
	cancel context.CancelCauseFunc
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus) *Service {
	return NewWithRunner(cfg, st, b, NewDockerRunner())
}

// NewWithRunner lets tests replace Docker with a fake runner.
func NewWithRunner(cfg *config.Config, st *store.Store, b *bus.Bus, r Runner) *Service {
	root := cfg.DataDir
	if cfg.SandboxHostDataDir != "" {
		root = cfg.SandboxHostDataDir
	}
	return &Service{cfg: cfg, store: st, bus: b, engine: &Engine{Runner: r, AllowedRoot: root},
		base: context.Background(), active: map[int64]*activeExec{}, runLocks: map[int64]chan struct{}{}}
}

// Startup ties executions to the server's lifetime, removes containers left by a crash and
// marks executions that were interrupted by a restart.
func (s *Service) Startup(ctx context.Context) {
	s.mu.Lock()
	s.base = ctx
	s.mu.Unlock()
	if s.store != nil {
		_, _ = s.store.Pool.Exec(ctx, `UPDATE sandbox_execs SET status='error', finished_at=now(),
			error='the API server stopped during this execution' WHERE status IN ('queued','running')`)
	}
	go func() {
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if n, err := s.engine.Runner.RemoveStale(cctx); err == nil && n > 0 {
			slog.Info("removed leftover sandbox containers", "count", n)
		}
	}()
}

// Limits returns the configured limits adapted to the Docker host's real CPUs and memory.
func (s *Service) Limits(ctx context.Context) Limits {
	s.limitsMu.Lock()
	defer s.limitsMu.Unlock()
	if s.limitsKnown {
		return s.limits
	}
	want := ConfiguredLimits(s.cfg)
	cpus, mem, err := s.engine.Runner.HostResources(ctx)
	if err != nil {
		return want // Docker is down; ask again next time
	}
	s.limits, s.limitsKnown = EffectiveLimits(want, cpus, mem), true
	if s.limits != want {
		slog.Info("sandbox limits adapted to the Docker host", "cpus", s.limits.CPUs(), "memory", units.BytesSize(float64(s.limits.MemoryBytes)))
	}
	return s.limits
}

// ConfiguredLimits parses SANDBOX_CPUS / SANDBOX_MEMORY / SANDBOX_PIDS / SANDBOX_TMPFS.
func ConfiguredLimits(cfg *config.Config) Limits {
	cpus, err := strconv.ParseFloat(cfg.SandboxCPUs, 64)
	if err != nil || cpus <= 0 {
		cpus = 2
	}
	mem, err := units.RAMInBytes(cfg.SandboxMemory)
	if err != nil || mem <= 0 {
		mem = 4 << 30
	}
	pids, err := strconv.ParseInt(cfg.SandboxPids, 10, 64)
	if err != nil || pids <= 0 {
		pids = 256
	}
	tmpfs, err := units.RAMInBytes(cfg.SandboxTmpfs)
	if err != nil || tmpfs <= 0 {
		tmpfs = 512 << 20
	}
	return Limits{NanoCPUs: int64(cpus * 1e9), MemoryBytes: mem, Pids: pids, TmpfsBytes: tmpfs}
}

// ProjectRel is the DATA_DIR-relative project folder of a run. The agent never chooses paths.
func ProjectRel(wsID, runID int64) string {
	return filepath.ToSlash(filepath.Join("workspaces", fmt.Sprint(wsID), "runs", fmt.Sprint(runID), "project"))
}

func (s *Service) ProjectDir(wsID, runID int64) string {
	return filepath.Join(s.cfg.DataDir, filepath.FromSlash(ProjectRel(wsID, runID)))
}

// hostPath is how the Docker daemon sees a DATA_DIR path (differs when the API runs in Docker).
func (s *Service) hostPath(p string) string {
	if s.cfg.SandboxHostDataDir == "" {
		return p
	}
	rel, _ := filepath.Rel(s.cfg.DataDir, p)
	return filepath.Join(s.cfg.SandboxHostDataDir, rel)
}

// ---------- per-run serialisation and cancellation ----------

func (s *Service) runLock(runID int64) chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.runLocks[runID]
	if !ok {
		l = make(chan struct{}, 1)
		s.runLocks[runID] = l
	}
	return l
}

// lockRun waits for the run's previous execution (the agent waits for a researcher's run).
func (s *Service) lockRun(ctx context.Context, runID int64) (func(), error) {
	l := s.runLock(runID)
	select {
	case l <- struct{}{}:
		return func() { <-l }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// tryLockRun fails immediately when the run already has an execution in progress.
func (s *Service) tryLockRun(runID int64) (func(), bool) {
	l := s.runLock(runID)
	select {
	case l <- struct{}{}:
		return func() { <-l }, true
	default:
		return nil, false
	}
}

func (s *Service) register(execID, runID int64, cancel context.CancelCauseFunc) {
	s.mu.Lock()
	s.active[execID] = &activeExec{runID: runID, cancel: cancel}
	s.mu.Unlock()
}

func (s *Service) unregister(execID int64) {
	s.mu.Lock()
	delete(s.active, execID)
	s.mu.Unlock()
}

// CancelExec kills a running execution's container. Returns false if it is not running here.
func (s *Service) CancelExec(execID int64) bool {
	s.mu.Lock()
	a := s.active[execID]
	s.mu.Unlock()
	if a == nil {
		return false
	}
	a.cancel(errCancelled)
	return true
}

// ---------- agent endpoint ----------

type ExecRequest struct {
	RunID          int64             `json:"run_id"`
	Phase          string            `json:"phase"` // install | execute | test
	Command        string            `json:"command"`
	TimeoutSec     int               `json:"timeout_sec"`
	Image          string            `json:"image"` // python | r
	Env            map[string]string `json:"env"`
	Agent          string            `json:"agent"`
	CollectMetrics *bool             `json:"collect_metrics"`
	// Attempt is the Coding Agent's write -> run -> fix attempt number (1 = first run).
	Attempt int `json:"attempt"`
	// RequiredMetrics must all be present in metrics.json for the execution to succeed.
	RequiredMetrics []string `json:"required_metrics"`
}

type MetricOut struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Value       float64 `json:"value"`
	LogLine     *int    `json:"log_line"`
	LogLineText string  `json:"log_line_text"`
}

type ExecResult struct {
	ExecID        int64       `json:"exec_id"`
	RunID         int64       `json:"run_id"`
	Phase         string      `json:"phase"`
	Status        string      `json:"status"` // succeeded | failed | timed_out | cancelled | error
	Attempt       int         `json:"attempt"`
	ExitCode      int         `json:"exit_code"`
	TimedOut      bool        `json:"timed_out"`
	Cancelled     bool        `json:"cancelled"`
	DurationMs    int64       `json:"duration_ms"`
	StartedAt     time.Time   `json:"started_at"`
	FinishedAt    time.Time   `json:"finished_at"`
	LogPath       string      `json:"log_path"`
	StderrPath    string      `json:"stderr_path"`
	LogHash       string      `json:"log_hash"`
	LogTail       string      `json:"log_tail"`
	StderrTail    string      `json:"stderr_tail"`
	CodeVersion   string      `json:"code_version"`
	Error         string      `json:"error,omitempty"`
	Metrics       []MetricOut `json:"metrics"`
	MetricsStatus string      `json:"metrics_status"`
	MetricsErr    string      `json:"metrics_error,omitempty"`
	Artifacts     []Artifact  `json:"artifacts"`
	Limits        Limits      `json:"limits"`
}

var envKeyRe = regexp.MustCompile(`^LAB_[A-Z0-9_]{1,40}$`)

// POST /internal/sandbox/exec (used by the agent worker only)
func (s *Service) HandleExec(w http.ResponseWriter, r *http.Request) error {
	var req ExecRequest
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	res, err := s.Exec(r.Context(), req)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

// Exec runs an agent's command synchronously (the agent worker waits; no browser request does).
// Agent commands are shell strings, but they run only inside the container.
func (s *Service) Exec(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	if req.Phase != "install" && req.Phase != "execute" && req.Phase != "test" {
		return nil, httpx.Errorf(http.StatusBadRequest, "phase must be install, execute or test")
	}
	if strings.TrimSpace(req.Command) == "" {
		return nil, httpx.Errorf(http.StatusBadRequest, "command is required")
	}
	for k := range req.Env {
		if !envKeyRe.MatchString(k) {
			return nil, httpx.Errorf(http.StatusBadRequest, "env keys must match LAB_[A-Z0-9_]+: "+k)
		}
	}
	run, err := s.store.RunByID(ctx, req.RunID)
	if err != nil {
		return nil, err
	}
	image := s.cfg.SandboxImagePython
	if req.Image == "r" {
		image = s.cfg.SandboxImageR
	}
	if req.Agent == "" {
		req.Agent = "sandbox"
	}
	collect := req.Phase == "execute"
	if req.CollectMetrics != nil {
		collect = *req.CollectMetrics
	}
	j := &job{run: run, phase: req.Phase, agent: req.Agent, source: "agent", attempt: req.Attempt,
		command: req.Command, argv: []string{"bash", "-c", req.Command}, env: req.Env, image: image,
		timeout: s.timeout(req.TimeoutSec), collect: collect, required: req.RequiredMetrics}

	unlock, err := s.lockRun(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	defer unlock()
	execID, err := s.insertExec(ctx, j)
	if err != nil {
		return nil, err
	}
	// The agent's HTTP request may be dropped; the container still obeys its own time limit,
	// and server shutdown still kills it.
	runCtx, cancel := context.WithCancelCause(s.serverCtx())
	defer cancel(nil)
	stop := context.AfterFunc(ctx, func() { cancel(context.Canceled) })
	defer stop()
	return s.execute(runCtx, cancel, j, execID), nil
}

func (s *Service) serverCtx() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.base
}

func (s *Service) timeout(sec int) time.Duration {
	t := time.Duration(sec) * time.Second
	if t <= 0 {
		t = time.Duration(s.cfg.SandboxTimeoutSec) * time.Second
	}
	return min(t, time.Duration(s.cfg.SandboxMaxTimeoutSec)*time.Second)
}

// ---------- the shared execution path ----------

type job struct {
	run        *store.Run
	phase      string
	agent      string
	source     string // agent | user
	userID     int64
	attempt    int
	entrypoint string
	command    string // shown to people
	argv       []string
	env        map[string]string
	image      string
	timeout    time.Duration
	collect    bool
	required   []string
}

func (s *Service) insertExec(ctx context.Context, j *job) (int64, error) {
	if j.attempt <= 0 {
		var n int
		_ = s.store.Pool.QueryRow(ctx, `SELECT count(*) FROM sandbox_execs WHERE run_id=$1 AND phase=$2`, j.run.ID, j.phase).Scan(&n)
		j.attempt = n + 1
	}
	var uid *int64
	if j.userID > 0 {
		uid = &j.userID
	}
	lim, _ := json.Marshal(s.Limits(ctx))
	var id int64
	err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO sandbox_execs (run_id, phase, command, image, status, source, agent, user_id, attempt, entrypoint, limits)
		VALUES ($1,$2,$3,$4,'running',$5,$6,$7,$8,$9,$10) RETURNING id`,
		j.run.ID, j.phase, j.command, j.image, j.source, j.agent, uid, j.attempt, j.entrypoint, lim).Scan(&id)
	return id, err
}

// writableDirs are the only project folders a container may write to.
var writableDirs = []string{"results", "models", "data", ".cache", ".pydeps"}

func (s *Service) prepareProject(project string) error {
	for _, d := range append([]string{"logs"}, writableDirs...) {
		p, err := ResolveNoSymlink(project, d)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(p, 0o777); err != nil {
			return err
		}
		_ = os.Chmod(p, 0o777) // the container user (uid 1000) must be able to write on Linux hosts
	}
	req := filepath.Join(project, "requirements.txt")
	if _, err := os.Lstat(req); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(req, nil, 0o666); err != nil {
			return err
		}
	}
	_ = os.Chmod(req, 0o666)
	return nil
}

// mountsFor: the project is read-only; only the designated output/cache folders are writable.
// The install phase may also rewrite requirements.txt (exact versions) and download into data/.
func (s *Service) mountsFor(run *store.Run, project, phase string) []Mount {
	hp := s.hostPath(project)
	ms := []Mount{{Source: hp, Target: "/work", ReadOnly: true}}
	if phase != "verify" {
		for _, d := range writableDirs {
			ms = append(ms, Mount{Source: filepath.Join(hp, d), Target: "/work/" + d})
		}
		if phase == "install" {
			ms = append(ms, Mount{Source: filepath.Join(hp, "requirements.txt"), Target: "/work/requirements.txt"})
		}
	}
	uploads := filepath.Join(s.cfg.DataDir, "workspaces", fmt.Sprint(run.WorkspaceID), "uploads")
	_ = os.MkdirAll(uploads, 0o755)
	ms = append(ms, Mount{Source: s.hostPath(uploads), Target: "/inputs", ReadOnly: true})
	return ms
}

func (s *Service) specFor(j *job, execID int64, project string, lim Limits) Spec {
	env := map[string]string{
		"HOME": "/tmp", "PYTHONUSERBASE": "/work/.pydeps", "PIP_CACHE_DIR": "/work/.cache/pip",
		"PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1", "MPLCONFIGDIR": "/tmp/mpl", "MPLBACKEND": "Agg",
		"LAB_RUN_ID": fmt.Sprint(j.run.ID), "LAB_PHASE": j.phase, "LAB_BUDGET": j.run.ComputeBudget,
		// Libraries see all host cores; tell them the container's real CPU limit to avoid oversubscription.
		"LAB_CPUS": trimFloat(math.Max(1, math.Floor(lim.CPUs()))), "OMP_NUM_THREADS": trimFloat(math.Max(1, math.Floor(lim.CPUs()))),
		"MKL_NUM_THREADS": trimFloat(math.Max(1, math.Floor(lim.CPUs()))),
	}
	for k, v := range j.env {
		env[k] = v
	}
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	envList := make([]string, 0, len(keys))
	for _, k := range keys {
		envList = append(envList, k+"="+env[k])
	}
	return Spec{
		Name: fmt.Sprintf("lab-run-%d-%d-%s", j.run.ID, execID, j.phase), Image: j.image, Cmd: j.argv, Env: envList,
		Mounts: s.mountsFor(j.run, project, j.phase), WorkDir: "/work", Network: j.phase == "install", Limits: lim,
		Labels: map[string]string{"tapu-sena.run": fmt.Sprint(j.run.ID), "tapu-sena.exec": fmt.Sprint(execID)},
	}
}

// execute runs one job to completion and records everything. It never returns an error: every
// failure (including Docker being down) is a recorded execution with a clear message.
func (s *Service) execute(ctx context.Context, cancel context.CancelCauseFunc, j *job, execID int64) *ExecResult {
	s.register(execID, j.run.ID, cancel)
	defer s.unregister(execID)
	bg := context.WithoutCancel(ctx)
	run := j.run
	project := s.ProjectDir(run.WorkspaceID, run.ID)
	lim := s.Limits(bg)
	res := &ExecResult{ExecID: execID, RunID: run.ID, Phase: j.phase, Attempt: j.attempt, Metrics: []MetricOut{},
		Artifacts: []Artifact{}, MetricsStatus: "not_collected", Limits: lim, StartedAt: time.Now(), ExitCode: -1}
	logRel := fmt.Sprintf("logs/%s-%d.log", j.phase, execID)
	errRel := fmt.Sprintf("logs/%s-%d.stderr.log", j.phase, execID)
	res.LogPath, res.StderrPath = logRel, errRel

	fail := func(status, msg string) {
		res.Status, res.Error = status, msg
	}
	if err := s.prepareProject(project); err != nil {
		fail("error", "could not prepare the workspace: "+err.Error())
		return s.finish(bg, j, res, project)
	}
	res.CodeVersion = s.codeVersion(project)
	if j.phase == "execute" {
		if p, err := ResolveNoSymlink(project, "results/metrics.json"); err == nil {
			_ = os.Remove(p) // a fresh metrics.json must come from this execution
		}
	}

	logFile, err1 := createLog(project, logRel)
	errFile, err2 := createLog(project, errRel)
	if err1 != nil || err2 != nil {
		fail("error", fmt.Sprintf("could not create log files: %v %v", err1, err2))
		return s.finish(bg, j, res, project)
	}
	combined := &capWriter{w: logFile, max: maxLogBytes}
	stderrW := io.MultiWriter(combined, &capWriter{w: errFile, max: maxLogBytes})

	s.bus.Emit(bg, store.Event{RunID: run.ID, Agent: j.agent, Type: "sandbox_started",
		Message: fmt.Sprintf("Sandbox %s (attempt %d): %s", j.phase, j.attempt, shorten(j.command, 120)),
		Why:     sandboxWhy(j.phase),
		Links:   mustJSON(map[string]any{"exec_id": execID, "log": logRel, "attempt": j.attempt, "source": j.source})})

	spec := s.specFor(j, execID, project, lim)
	out, runErr := s.engine.Run(ctx, spec, j.timeout, combined, stderrW)
	res.StartedAt, res.FinishedAt = out.Started, out.Finished
	res.ExitCode, res.TimedOut, res.Cancelled = out.ExitCode, out.TimedOut, out.Cancelled
	switch {
	case runErr != nil:
		msg := runErr.Error()
		if errors.Is(runErr, ErrDockerUnavailable) {
			msg = "Docker is not available, so the code was not run. Start Docker Desktop (or the Docker daemon) and try again. (" + runErr.Error() + ")"
		} else if errors.Is(runErr, context.Canceled) {
			msg = "the execution was interrupted (the server or agent stopped waiting)"
		}
		fmt.Fprintf(combined, "\n[sandbox] %s\n", msg)
		fail("error", msg)
	case out.Cancelled:
		fmt.Fprintf(combined, "\n[sandbox] cancelled by the researcher; container stopped and removed\n")
		fail("cancelled", "cancelled by the researcher")
	case out.TimedOut:
		fmt.Fprintf(combined, "\n[sandbox] time limit of %s reached; container stopped and removed\n", j.timeout)
		fail("timed_out", fmt.Sprintf("the time limit of %s was reached", j.timeout))
	case out.ExitCode != 0:
		msg := fmt.Sprintf("the program exited with code %d", out.ExitCode)
		if out.OOMKilled || out.ExitCode == 137 {
			msg = fmt.Sprintf("the container was killed (exit %d), usually because it ran out of memory (limit %s)",
				out.ExitCode, units.BytesSize(float64(lim.MemoryBytes)))
			fmt.Fprintf(combined, "\n[sandbox] Killed: %s\n", msg)
		}
		fail("failed", msg)
	default:
		res.Status = "succeeded"
	}

	if res.Status == "succeeded" && j.collect {
		doc, err := LoadMetrics(project, j.required, ArtifactLimits{
			MaxFileBytes: s.cfg.SandboxMaxArtifactMB << 20, MaxTotalBytes: s.cfg.SandboxMaxArtifactTotalMB << 20})
		switch {
		case errors.Is(err, errMetricsMissing):
			res.MetricsStatus, res.MetricsErr = "missing", err.Error()
		case err != nil:
			res.MetricsStatus, res.MetricsErr = "invalid", err.Error()
		default:
			res.Artifacts = doc.Artifacts
			if verr := s.verifyModels(ctx, j, execID, project, lim, res.Artifacts, combined); verr != nil {
				res.MetricsStatus, res.MetricsErr = "invalid", verr.Error()
			} else {
				res.MetricsStatus = "valid"
				// The log is final only after verification; hash it, then link every number to it.
				_ = logFile.Sync()
				hash, _ := hashAndTail(filepath.Join(project, filepath.FromSlash(logRel)))
				ms, err := s.ingestMetrics(bg, run.ID, execID, doc, filepath.Join(project, filepath.FromSlash(logRel)), logRel, hash, res.CodeVersion)
				if err != nil {
					res.MetricsStatus, res.MetricsErr = "invalid", err.Error()
				} else {
					res.Metrics = ms
				}
			}
		}
		if res.MetricsStatus != "valid" {
			fmt.Fprintf(combined, "\n[sandbox] results rejected: %s\n", res.MetricsErr)
			fail("failed", "results rejected: "+res.MetricsErr)
		}
	}
	logFile.Close()
	errFile.Close()
	return s.finish(bg, j, res, project)
}

// verifyModels loads every model artifact in a second fresh, offline, read-only container.
func (s *Service) verifyModels(ctx context.Context, j *job, execID int64, project string, lim Limits, arts []Artifact, log io.Writer) error {
	type item struct {
		Path   string `json:"path"`
		Format string `json:"format"`
	}
	var items []item
	for _, a := range arts {
		if a.Kind == "model" {
			items = append(items, item{a.Path, a.Format})
		}
	}
	if len(items) == 0 {
		return nil
	}
	list, _ := json.Marshal(items)
	fmt.Fprintf(log, "\n[sandbox] verifying that %d saved model(s) load in a fresh container\n", len(items))
	vj := *j
	vj.phase, vj.argv, vj.env = "verify", []string{"python", "-I", "-c", verifyScript}, map[string]string{"LAB_VERIFY": string(list)}
	spec := s.specFor(&vj, execID, project, lim)
	var buf strings.Builder
	w := io.MultiWriter(log, &buf)
	out, err := s.engine.Run(ctx, spec, verifyTimeout, w, w)
	results := map[string]string{}
	for _, line := range strings.Split(buf.String(), "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "OK "); ok {
			p, _, _ := strings.Cut(rest, ": ")
			results[p] = ""
		} else if rest, ok := strings.CutPrefix(line, "FAIL "); ok {
			p, msg, _ := strings.Cut(rest, ": ")
			results[p] = msg
		}
	}
	var failed []string
	for i := range arts {
		if arts[i].Kind != "model" {
			continue
		}
		msg, seen := results[arts[i].Path]
		ok := seen && msg == "" && err == nil && out.ExitCode == 0
		arts[i].Verified = &ok
		if !ok {
			if msg == "" {
				msg = "the model could not be loaded"
			}
			arts[i].Error = msg
			failed = append(failed, arts[i].Path+": "+msg)
		}
	}
	switch {
	case err != nil:
		return fmt.Errorf("model verification could not run: %v", err)
	case out.TimedOut || out.Cancelled:
		return errors.New("model verification did not finish")
	case len(failed) > 0:
		return fmt.Errorf("saved model could not be loaded: %s", strings.Join(failed, "; "))
	}
	return nil
}

func (s *Service) finish(ctx context.Context, j *job, res *ExecResult, project string) *ExecResult {
	if res.FinishedAt.IsZero() {
		res.FinishedAt = time.Now()
	}
	res.DurationMs = res.FinishedAt.Sub(res.StartedAt).Milliseconds()
	logPath := filepath.Join(project, filepath.FromSlash(res.LogPath))
	res.LogHash, res.LogTail = hashAndTail(logPath)
	_, res.StderrTail = hashAndTail(filepath.Join(project, filepath.FromSlash(res.StderrPath)))
	arts, _ := json.Marshal(res.Artifacts)
	if _, err := s.store.Pool.Exec(ctx, `
		UPDATE sandbox_execs SET status=$2, exit_code=$3, timed_out=$4, cancelled=$5, duration_ms=$6, log_path=$7,
			stderr_path=$8, log_hash=$9, code_version=$10, error=$11, metrics_status=$12, metrics_error=$13,
			artifacts=$14, started_at=$15, finished_at=$16
		WHERE id=$1`, res.ExecID, res.Status, res.ExitCode, res.TimedOut, res.Cancelled, res.DurationMs, res.LogPath,
		res.StderrPath, res.LogHash, res.CodeVersion, shorten(res.Error, 2000), res.MetricsStatus, shorten(res.MetricsErr, 2000),
		arts, res.StartedAt, res.FinishedAt); err != nil {
		slog.Error("sandbox: record execution", "exec_id", res.ExecID, "err", err)
	}
	if res.CodeVersion != "" {
		_, _ = s.store.Pool.Exec(ctx, `UPDATE runs SET git_commit=$2 WHERE id=$1`, j.run.ID, res.CodeVersion)
	}
	msg := fmt.Sprintf("Sandbox %s attempt %d: %s in %.1fs", j.phase, j.attempt, statusText(res), float64(res.DurationMs)/1000)
	if len(res.Metrics) > 0 {
		msg += fmt.Sprintf("; recorded %d validated metrics from metrics.json", len(res.Metrics))
	}
	s.bus.Emit(ctx, store.Event{RunID: j.run.ID, Agent: j.agent, Type: "sandbox_finished", Message: msg,
		Why: res.Error,
		Links: mustJSON(map[string]any{"exec_id": res.ExecID, "log": res.LogPath, "exit_code": res.ExitCode, "status": res.Status,
			"attempt": j.attempt, "code_version": res.CodeVersion, "source": j.source}),
		Cost: mustJSON(map[string]any{"tokens": 0, "sandbox_seconds": math.Round(float64(res.DurationMs)/100) / 10})})
	return res
}

func statusText(r *ExecResult) string {
	switch r.Status {
	case "succeeded":
		return "succeeded"
	case "timed_out":
		return "timed out"
	case "cancelled":
		return "cancelled"
	case "error":
		return "could not run (" + shorten(r.Error, 100) + ")"
	}
	return fmt.Sprintf("failed (exit %d)", r.ExitCode)
}

func sandboxWhy(phase string) string {
	switch phase {
	case "install":
		return "Install step: internet is on only now, to download libraries and datasets"
	case "test":
		return "Running tests offline inside a fresh container"
	}
	return "Running offline inside a fresh container with CPU, memory, process and time limits"
}

// createLog creates a fresh log file and never follows a planted symlink.
func createLog(project, rel string) (*os.File, error) {
	p, err := ResolveNoSymlink(project, rel)
	if err != nil {
		return nil, err
	}
	_ = os.Remove(p)
	return os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
}

// capWriter stops writing after max bytes (and says so once).
type capWriter struct {
	mu   sync.Mutex
	w    io.Writer
	n    int64
	max  int64
	said bool
}

func (c *capWriter) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.n >= c.max {
		if !c.said {
			c.said = true
			_, _ = c.w.Write([]byte("\n[sandbox] output truncated: log limit reached\n"))
		}
		return len(p), nil
	}
	room := c.max - c.n
	q := p
	if int64(len(q)) > room {
		q = q[:room]
	}
	n, err := c.w.Write(q)
	c.n += int64(n)
	if err != nil {
		return n, err
	}
	return len(p), nil
}

// ---------- code version snapshot ----------

// snapshotIgnore lists what is never part of a code version.
const snapshotIgnore = "data/\nlogs/\n.pydeps/\n.cache/\nresults/\nmodels/\n__pycache__/\n*.pt\n*.pth\n*.ckpt\n.pytest_cache/\n.git/\n"

// GitDir is where a run's code-version repository lives: next to the project folder, never
// inside it. Sandboxed code must never be able to plant hooks or config (core.fsmonitor,
// hooks/*) that the host's git would then execute (audit SEC-01).
func GitDir(project string) string { return filepath.Join(filepath.Dir(project), "meta.git") }

// gitArgs are the hardened options for every host-side git call on a sandbox project.
func gitArgs(gitDir, project string) []string {
	return []string{
		"--git-dir=" + gitDir, "--work-tree=" + project,
		"-c", "user.name=Lab Sandbox", "-c", "user.email=lab@localhost",
		"-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "safe.directory=*",
		"-c", "core.hooksPath=" + filepath.ToSlash(filepath.Join(gitDir, "no-hooks")),
		"-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.symlinks=true",
		"-c", "core.excludesFile=" + filepath.ToSlash(filepath.Join(gitDir, "info", "exclude")),
	}
}

// codeVersion commits the project (excluding data, logs, deps, results) into a repository kept
// outside the sandbox mount and returns the commit hash. Falls back to a content hash.
func (s *Service) codeVersion(project string) string {
	s.gitMu.Lock()
	defer s.gitMu.Unlock()
	// The pushed repository gets a .gitignore too; the snapshot itself relies only on info/exclude,
	// which sandboxed code cannot edit.
	if p, err := ResolveNoSymlink(project, ".gitignore"); err == nil {
		_ = os.Remove(p)
		if f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644); err == nil {
			_, _ = f.WriteString(snapshotIgnore)
			f.Close()
		}
	}

	gitDir := GitDir(project)
	git := func(args ...string) (string, error) {
		c := exec.Command("git", append(gitArgs(gitDir, project), args...)...)
		c.Dir = filepath.Dir(project)
		c.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0")
		out, err := c.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	if _, err := exec.LookPath("git"); err == nil {
		if _, err := os.Stat(filepath.Join(gitDir, "HEAD")); err != nil {
			if _, err := git("init", "-q"); err != nil {
				return contentHash(project)
			}
		}
		_ = os.MkdirAll(filepath.Join(gitDir, "no-hooks"), 0o755)
		_ = os.MkdirAll(filepath.Join(gitDir, "info"), 0o755)
		_ = os.WriteFile(filepath.Join(gitDir, "info", "exclude"), []byte(snapshotIgnore), 0o644)
		_, _ = git("add", "-A")
		_, _ = git("commit", "-q", "--allow-empty", "-m", "sandbox snapshot")
		if sha, err := git("rev-parse", "--short=12", "HEAD"); err == nil {
			return sha
		}
	}
	return contentHash(project)
}

func contentHash(project string) string {
	h := sha256.New()
	_ = filepath.WalkDir(project, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(project, p)
		top := strings.Split(filepath.ToSlash(rel), "/")[0]
		if d.IsDir() && (top == "data" || top == "logs" || top == ".pydeps" || top == ".cache" || top == ".git" || top == "results" || top == "models") {
			return filepath.SkipDir
		}
		if d.Type().IsRegular() {
			f, err := os.Open(p)
			if err == nil {
				h.Write([]byte(rel))
				_, _ = io.Copy(h, f)
				f.Close()
			}
		}
		return nil
	})
	return "sha256:" + hex.EncodeToString(h.Sum(nil))[:12]
}

func hashAndTail(path string) (string, string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	sum := sha256.Sum256(data)
	tail := data
	if len(tail) > logTailSize {
		tail = tail[len(tail)-logTailSize:]
	}
	return "sha256:" + hex.EncodeToString(sum[:]), string(tail)
}

// ingestMetrics stores every validated number with its proof: run, exec, code version, log file
// hash and the log line that printed it.
func (s *Service) ingestMetrics(ctx context.Context, runID, execID int64, doc *MetricsDoc, logPath, logRel, logHash, codeVersion string) ([]MetricOut, error) {
	lines := readLines(logPath)
	names := make([]string, 0, len(doc.Metrics))
	for k := range doc.Metrics {
		names = append(names, k)
	}
	sort.Strings(names)
	out := make([]MetricOut, 0, len(names))
	for _, name := range names {
		v := doc.Metrics[name]
		lineNo, lineText := findLogLine(lines, name, v)
		var id int64
		if err := s.store.Pool.QueryRow(ctx, `
			INSERT INTO metrics (run_id, exec_id, name, value, code_version, log_file, log_file_hash, log_line, log_line_text)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
			runID, execID, name, v, codeVersion, logRel, logHash, lineNo, lineText).Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, MetricOut{ID: id, Name: name, Value: v, LogLine: lineNo, LogLineText: lineText})
	}
	return out, nil
}

func flatten(prefix string, v any, out map[string]float64) {
	switch t := v.(type) {
	case float64:
		if !math.IsNaN(t) && !math.IsInf(t, 0) && prefix != "" {
			out[prefix] = t
		}
	case map[string]any:
		for k, child := range t {
			key := k
			if prefix != "" {
				key = prefix + "." + k
			}
			flatten(key, child, out)
		}
	}
}

func readLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if sc.Err() != nil {
		return lines
	}
	return lines
}

// findLogLine returns the last log line mentioning the metric name (preferring one that also
// contains the value), 1-based.
func findLogLine(lines []string, name string, v float64) (*int, string) {
	short := name[strings.LastIndex(name, ".")+1:]
	vals := []string{trimFloat(v), fmt.Sprintf("%.2f", v), fmt.Sprintf("%.4f", v)}
	best := -1
	for i := len(lines) - 1; i >= 0; i-- {
		l := lines[i]
		if !strings.Contains(l, short) {
			continue
		}
		if best == -1 {
			best = i
		}
		for _, s := range vals {
			if strings.Contains(l, s) {
				n := i + 1
				return &n, shorten(l, 300)
			}
		}
	}
	if best >= 0 {
		n := best + 1
		return &n, shorten(lines[best], 300)
	}
	return nil, ""
}

func trimFloat(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return fmt.Sprintf("%d", int64(v))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", v), "0"), ".")
}

func shorten(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// Status reports whether Docker answers and the sandbox image exists (for /healthz and the UI).
func (s *Service) Status(ctx context.Context) map[string]any {
	out := map[string]any{"mode": "docker", "image": s.cfg.SandboxImagePython, "available": false, "image_present": false}
	lim := s.Limits(ctx)
	out["limits"] = map[string]any{"cpus": lim.CPUs(), "memory_bytes": lim.MemoryBytes, "pids": lim.Pids,
		"timeout_sec": s.cfg.SandboxTimeoutSec, "max_timeout_sec": s.cfg.SandboxMaxTimeoutSec, "network": "none (install step only)"}
	if err := s.engine.Runner.Ping(ctx); err != nil {
		out["error"] = "Docker is not available: " + err.Error()
		return out
	}
	out["available"] = true
	ok, err := s.engine.Runner.ImagePresent(ctx, s.cfg.SandboxImagePython)
	out["image_present"] = ok
	if err != nil {
		out["error"] = err.Error()
	} else if !ok {
		out["error"] = fmt.Sprintf("The sandbox image %s is not built. Run: docker build -t %s infra/sandbox-images/python",
			s.cfg.SandboxImagePython, s.cfg.SandboxImagePython)
	}
	return out
}
