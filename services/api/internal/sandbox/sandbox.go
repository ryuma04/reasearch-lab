// Package sandbox runs agent-written code in a fresh, limited Docker container per execution,
// and turns results/metrics.json into proof-linked metrics (Hero 2: no number without proof).
//
// Safety rules (allaboutourproject.md 16.2): CPU/memory/process/time limits, network only in
// the install phase, non-root user, no capabilities, only the run's project folder is mounted
// (read-write) plus the workspace uploads (read-only).
package sandbox

import (
	"bufio"
	"bytes"
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
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ryuma04/tapu-sena/services/api/internal/bus"
	"github.com/ryuma04/tapu-sena/services/api/internal/config"
	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
)

const (
	maxTimeout  = 3 * time.Hour
	logTailSize = 12 << 10
)

type Service struct {
	cfg   *config.Config
	store *store.Store
	bus   *bus.Bus
	gitMu sync.Mutex
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus) *Service {
	return &Service{cfg: cfg, store: st, bus: b}
}

// ProjectRel is the DATA_DIR-relative project folder of a run. The agent never chooses paths.
func ProjectRel(wsID, runID int64) string {
	return filepath.ToSlash(filepath.Join("workspaces", fmt.Sprint(wsID), "runs", fmt.Sprint(runID), "project"))
}

func (s *Service) ProjectDir(wsID, runID int64) string {
	return filepath.Join(s.cfg.DataDir, filepath.FromSlash(ProjectRel(wsID, runID)))
}

type ExecRequest struct {
	RunID          int64             `json:"run_id"`
	Phase          string            `json:"phase"` // install | execute | test
	Command        string            `json:"command"`
	TimeoutSec     int               `json:"timeout_sec"`
	Image          string            `json:"image"` // python | r
	Env            map[string]string `json:"env"`
	Agent          string            `json:"agent"`
	CollectMetrics *bool             `json:"collect_metrics"`
}

type MetricOut struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Value       float64 `json:"value"`
	LogLine     *int    `json:"log_line"`
	LogLineText string  `json:"log_line_text"`
}

type ExecResult struct {
	ExecID      int64       `json:"exec_id"`
	ExitCode    int         `json:"exit_code"`
	TimedOut    bool        `json:"timed_out"`
	DurationMs  int64       `json:"duration_ms"`
	LogPath     string      `json:"log_path"`
	LogHash     string      `json:"log_hash"`
	LogTail     string      `json:"log_tail"`
	CodeVersion string      `json:"code_version"`
	Metrics     []MetricOut `json:"metrics"`
	MetricsErr  string      `json:"metrics_error,omitempty"`
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
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Minute
	}
	timeout = min(timeout, maxTimeout)
	image := s.cfg.SandboxImagePython
	if req.Image == "r" {
		image = s.cfg.SandboxImageR
	}
	if req.Agent == "" {
		req.Agent = "sandbox"
	}

	project := s.ProjectDir(run.WorkspaceID, run.ID)
	if err := os.MkdirAll(filepath.Join(project, "logs"), 0o777); err != nil {
		return nil, err
	}
	codeVersion := s.codeVersion(project)

	var execID int64
	if err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO sandbox_execs (run_id, phase, command, image, code_version) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		run.ID, req.Phase, req.Command, image, codeVersion).Scan(&execID); err != nil {
		return nil, err
	}
	logRel := fmt.Sprintf("logs/%s-%d.log", req.Phase, execID)
	logPath := filepath.Join(project, filepath.FromSlash(logRel))
	metricsPath := filepath.Join(project, "results", "metrics.json")
	if req.Phase == "execute" {
		_ = os.Remove(metricsPath) // a fresh metrics.json must come from this execution
	}

	s.bus.Emit(ctx, store.Event{RunID: run.ID, Agent: req.Agent, Type: "sandbox_started",
		Message: fmt.Sprintf("Sandbox %s: %s", req.Phase, shorten(req.Command, 120)),
		Why:     sandboxWhy(req.Phase),
		Links:   mustJSON(map[string]any{"exec_id": execID, "log": logRel})})

	start := time.Now()
	exitCode, timedOut, runErr := s.runContainer(ctx, run, execID, req, image, project, logPath, timeout)
	dur := time.Since(start)
	if runErr != nil {
		slog.Error("sandbox run", "run_id", run.ID, "exec_id", execID, "err", runErr)
		appendLog(logPath, "\n[sandbox] failed to start: "+runErr.Error()+"\n")
		exitCode = -1
	}

	logHash, tail := hashAndTail(logPath)
	res := &ExecResult{ExecID: execID, ExitCode: exitCode, TimedOut: timedOut, DurationMs: dur.Milliseconds(),
		LogPath: logRel, LogHash: logHash, LogTail: tail, CodeVersion: codeVersion, Metrics: []MetricOut{}}

	if _, err := s.store.Pool.Exec(ctx, `
		UPDATE sandbox_execs SET exit_code=$2, timed_out=$3, duration_ms=$4, log_path=$5, log_hash=$6, finished_at=now()
		WHERE id=$1`, execID, exitCode, timedOut, res.DurationMs, logRel, logHash); err != nil {
		return nil, err
	}

	collect := req.Phase == "execute"
	if req.CollectMetrics != nil {
		collect = *req.CollectMetrics
	}
	if collect && exitCode == 0 {
		ms, err := s.ingestMetrics(ctx, run.ID, execID, metricsPath, start, logPath, logRel, logHash, codeVersion)
		if err != nil {
			res.MetricsErr = err.Error()
		} else {
			res.Metrics = ms
		}
	}
	if codeVersion != "" {
		_, _ = s.store.Pool.Exec(ctx, `UPDATE runs SET git_commit=$2 WHERE id=$1`, run.ID, codeVersion)
	}

	status := "ok"
	if timedOut {
		status = "timed out"
	} else if exitCode != 0 {
		status = fmt.Sprintf("failed (exit %d)", exitCode)
	}
	msg := fmt.Sprintf("Sandbox %s %s in %.1fs", req.Phase, status, dur.Seconds())
	if len(res.Metrics) > 0 {
		msg += fmt.Sprintf("; recorded %d metrics from metrics.json", len(res.Metrics))
	}
	s.bus.Emit(ctx, store.Event{RunID: run.ID, Agent: req.Agent, Type: "sandbox_finished", Message: msg,
		Links: mustJSON(map[string]any{"exec_id": execID, "log": logRel, "exit_code": exitCode, "code_version": codeVersion}),
		Cost:  mustJSON(map[string]any{"tokens": 0, "sandbox_seconds": math.Round(dur.Seconds()*10) / 10})})
	return res, nil
}

func sandboxWhy(phase string) string {
	switch phase {
	case "install":
		return "Install step: internet is on only now, to download libraries and datasets"
	case "test":
		return "Running tests offline inside a fresh container"
	}
	return "Running offline inside a fresh container with CPU, memory and time limits"
}

func (s *Service) runContainer(ctx context.Context, run *store.Run, execID int64, req ExecRequest, image, project, logPath string, timeout time.Duration) (int, bool, error) {
	logFile, err := os.Create(logPath)
	if err != nil {
		return -1, false, err
	}
	defer logFile.Close()

	env := map[string]string{
		"LAB_RUN_ID": fmt.Sprint(run.ID), "LAB_PHASE": req.Phase, "LAB_BUDGET": run.ComputeBudget,
		// Libraries see all host cores; tell them the container's real CPU limit to avoid oversubscription.
		"LAB_CPUS": s.cfg.SandboxCPUs, "OMP_NUM_THREADS": s.cfg.SandboxCPUs, "MKL_NUM_THREADS": s.cfg.SandboxCPUs,
	}
	for k, v := range req.Env {
		env[k] = v
	}

	runCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()

	var cmd *exec.Cmd
	name := fmt.Sprintf("lab-run-%d-%d", run.ID, execID)
	if s.cfg.SandboxMode == "local" {
		// Development only: no isolation at all.
		fmt.Fprintf(logFile, "[sandbox] WARNING: SANDBOX_MODE=local, running without isolation\n")
		cmd = exec.CommandContext(runCtx, shellPath(), "-c", req.Command)
		cmd.Dir = project
		cmd.Env = append(os.Environ(), "PYTHONUSERBASE="+filepath.Join(project, ".pydeps"), "PYTHONUNBUFFERED=1")
		for k, v := range env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	} else {
		hostProject := project
		hostUploads := filepath.Join(s.cfg.DataDir, "workspaces", fmt.Sprint(run.WorkspaceID), "uploads")
		if s.cfg.SandboxHostDataDir != "" {
			rel, _ := filepath.Rel(s.cfg.DataDir, project)
			hostProject = filepath.Join(s.cfg.SandboxHostDataDir, rel)
			hostUploads = filepath.Join(s.cfg.SandboxHostDataDir, "workspaces", fmt.Sprint(run.WorkspaceID), "uploads")
		}
		_ = os.MkdirAll(filepath.Join(s.cfg.DataDir, "workspaces", fmt.Sprint(run.WorkspaceID), "uploads"), 0o755)
		network := "none"
		if req.Phase == "install" {
			network = "bridge"
		}
		args := []string{"run", "--rm", "--name", name,
			"--cpus", s.cfg.SandboxCPUs, "--memory", s.cfg.SandboxMemory, "--pids-limit", s.cfg.SandboxPids,
			"--network", network, "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
			"-v", hostProject + ":/work", "-v", hostUploads + ":/inputs:ro", "-w", "/work",
			"-e", "HOME=/tmp", "-e", "PYTHONUSERBASE=/work/.pydeps", "-e", "PIP_CACHE_DIR=/work/.cache/pip",
			"-e", "PYTHONUNBUFFERED=1", "-e", "MPLCONFIGDIR=/tmp/mpl",
		}
		keys := make([]string, 0, len(env))
		for k := range env {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			args = append(args, "-e", k+"="+env[k])
		}
		args = append(args, image, "bash", "-c", req.Command)
		cmd = exec.CommandContext(runCtx, "docker", args...)
		cmd.Cancel = func() error {
			// Kill the container, not just the docker CLI process. Bounded, so a stuck Docker
			// daemon can never hold a run past its time limit.
			kctx, kcancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer kcancel()
			_ = exec.CommandContext(kctx, "docker", "kill", name).Run()
			return cmd.Process.Kill()
		}
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.WaitDelay = 10 * time.Second

	err = cmd.Run()
	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	if timedOut {
		fmt.Fprintf(logFile, "\n[sandbox] time limit of %s reached; container stopped\n", timeout)
		return -1, true, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		if exitErr.ExitCode() == 137 {
			fmt.Fprintf(logFile, "\n[sandbox] Killed: the container was stopped (exit 137), usually because it ran out of memory (limit %s)\n", s.cfg.SandboxMemory)
		}
		return exitErr.ExitCode(), false, nil
	}
	if err != nil {
		return -1, false, err
	}
	return 0, false, nil
}

func shellPath() string {
	if p, err := exec.LookPath("bash"); err == nil {
		return p
	}
	if runtime.GOOS == "windows" {
		return "cmd"
	}
	return "sh"
}

// codeVersion commits the project (excluding data, logs, deps) into a local git repo and
// returns the commit hash. Falls back to a content hash if git is unavailable.
func (s *Service) codeVersion(project string) string {
	s.gitMu.Lock()
	defer s.gitMu.Unlock()
	ignore := "data/\nlogs/\n.pydeps/\n.cache/\nresults/\n__pycache__/\n*.pt\n*.pth\n*.ckpt\n.pytest_cache/\n"
	_ = os.WriteFile(filepath.Join(project, ".gitignore"), []byte(ignore), 0o644)

	git := func(args ...string) (string, error) {
		c := exec.Command("git", append([]string{"-c", "user.name=Lab Sandbox", "-c", "user.email=lab@localhost",
			"-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "safe.directory=*"}, args...)...)
		c.Dir = project
		out, err := c.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	if _, err := exec.LookPath("git"); err == nil {
		if _, err := os.Stat(filepath.Join(project, ".git")); err != nil {
			if _, err := git("init", "-q"); err != nil {
				return contentHash(project)
			}
		}
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
		if d.IsDir() && (top == "data" || top == "logs" || top == ".pydeps" || top == ".cache" || top == ".git" || top == "results") {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			f, err := os.Open(p)
			if err == nil {
				h.Write([]byte(rel))
				io.Copy(h, f)
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

func appendLog(path, text string) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		f.WriteString(text)
		f.Close()
	}
}

// ingestMetrics reads metrics.json written during THIS execution and stores every number
// with its proof: run, exec, code version, log file hash and the log line that printed it.
func (s *Service) ingestMetrics(ctx context.Context, runID, execID int64, path string, since time.Time, logPath, logRel, logHash, codeVersion string) ([]MetricOut, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, errors.New("results/metrics.json was not written by the code")
	}
	if st.ModTime().Before(since.Add(-2 * time.Second)) {
		return nil, errors.New("results/metrics.json is older than this execution; ignored")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("metrics.json is not valid JSON: %w", err)
	}
	flat := map[string]float64{}
	flatten("", doc, flat)
	if len(flat) == 0 {
		return nil, errors.New("metrics.json contains no numbers")
	}
	lines := readLines(logPath)

	names := make([]string, 0, len(flat))
	for k := range flat {
		names = append(names, k)
	}
	sort.Strings(names)
	out := make([]MetricOut, 0, len(names))
	for _, name := range names {
		v := flat[name]
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
	case bool:
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

// DockerAvailable reports whether the docker daemon answers (for /healthz).
func DockerAvailable(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var out bytes.Buffer
	c := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}")
	c.Stdout = &out
	return c.Run() == nil && out.Len() > 0
}
