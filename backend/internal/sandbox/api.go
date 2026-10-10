package sandbox

// Browser API for the code sandbox. Every handler checks the session user's role in the run's
// workspace (viewer to read, editor to change or execute). Executions are started
// asynchronously: the request returns 202 at once and the browser polls status and logs.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"time"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

const maxLogChunk = 256 << 10

// Routes registers the logged-in sandbox routes (call inside the auth.Require group).
func (s *Service) Routes(r interface {
	Get(string, http.HandlerFunc)
	Put(string, http.HandlerFunc)
	Post(string, http.HandlerFunc)
}) {
	h := httpx.Handler
	r.Get("/sandbox/status", h(s.HandleStatus))
	r.Put("/runs/{id}/file", h(s.SaveFile))
	r.Get("/runs/{id}/artifact", h(s.DownloadArtifact))
	r.Post("/runs/{id}/sandbox/executions", h(s.StartExecution))
	r.Get("/runs/{id}/sandbox/executions", h(s.ListExecutions))
	r.Get("/sandbox/executions/{execId}", h(s.GetExecution))
	r.Get("/sandbox/executions/{execId}/logs", h(s.ExecutionLogs))
	r.Post("/sandbox/executions/{execId}/cancel", h(s.CancelExecution))
	r.Post("/runs/{id}/sandbox/heal", h(s.StartHeal))
	r.Get("/runs/{id}/sandbox/heal", h(s.ListHeal))
}

func (s *Service) runFor(r *http.Request, minRole string) (*store.Run, error) {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return nil, err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, minRole); err != nil {
		return nil, err
	}
	return run, nil
}

// GET /sandbox/status â€” Docker availability, image and the limits that will be applied.
func (s *Service) HandleStatus(w http.ResponseWriter, r *http.Request) error {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	httpx.JSON(w, http.StatusOK, s.Status(ctx))
	return nil
}

// PUT /runs/{id}/file {"path": "src/train.py", "content": "..."} â€” saves an editable source file.
func (s *Service) SaveFile(w http.ResponseWriter, r *http.Request) error {
	run, err := s.runFor(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxSourceBytes+(64<<10))
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return httpx.Errorf(http.StatusBadRequest, "invalid JSON body (files are limited to 1 MB)")
	}
	rel, err := EditablePath(body.Path)
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, err.Error())
	}
	if len(body.Content) > MaxSourceBytes {
		return httpx.Errorf(http.StatusRequestEntityTooLarge, "file is larger than 1 MB")
	}
	if !utf8.ValidString(body.Content) || containsNUL(body.Content) {
		return httpx.Errorf(http.StatusBadRequest, "file content must be UTF-8 text")
	}
	if run.Status == "queued" || run.Status == "running" {
		return httpx.Errorf(http.StatusConflict, "the agents are working on this run; edit the code when it stops at a checkpoint or is paused")
	}
	if s.activeHeal(r.Context(), run.ID) {
		return httpx.Errorf(http.StatusConflict, "the debugger is fixing this run; wait for it to finish before editing")
	}
	if unlock, ok := s.tryLockRun(run.ID); ok {
		defer unlock()
	} else {
		return httpx.Errorf(http.StatusConflict, "an execution is running for this run; wait for it or cancel it before saving")
	}
	project := s.ProjectDir(run.WorkspaceID, run.ID)
	if _, err := os.Stat(project); err != nil {
		return httpx.Errorf(http.StatusConflict, "this run has no code yet: the Coding Agent creates the project after the plan is approved")
	}
	full, err := ResolveNoSymlink(project, rel)
	if err != nil {
		return httpx.ErrForbidden
	}
	if err := writeAtomic(full, []byte(body.Content)); err != nil {
		return err
	}
	info, _ := os.Stat(full)
	s.bus.Emit(r.Context(), store.Event{RunID: run.ID, Agent: "researcher", Type: "file_saved",
		Message: "Researcher edited " + rel, Why: "Edited in the code sandbox",
		Links: mustJSON(map[string]any{"file": rel, "user_id": auth.UserID(r.Context())})})
	httpx.JSON(w, http.StatusOK, map[string]any{"path": rel, "size": info.Size(), "saved_at": time.Now().UTC()})
	return nil
}

// writeAtomic writes to a temp file in the same folder and renames it over the target, so a
// symlink planted at the target is replaced rather than followed.
func writeAtomic(full string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(full), ".save-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	_ = os.Chmod(tmp.Name(), 0o644)
	// On Windows, Docker Desktop's file sharing can hold the old file open for a moment after a
	// container exits, which makes the replace fail with "Access is denied"; retry briefly.
	var err2 error
	for i := 0; i < 20; i++ {
		if err2 = os.Rename(tmp.Name(), full); err2 == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer os.Remove(tmp.Name())
	// Last resort: overwrite in place, but only a regular file (never through a symlink).
	if st, err := os.Lstat(full); err == nil && st.Mode().IsRegular() {
		return os.WriteFile(full, data, 0o644)
	}
	return err2
}

func containsNUL(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return true
		}
	}
	return false
}

// POST /runs/{id}/sandbox/executions {"entrypoint": "src/train.py", "timeout_sec": 300}
func (s *Service) StartExecution(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	run, err := s.runFor(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Entrypoint string `json:"entrypoint"`
		TimeoutSec int    `json:"timeout_sec"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	entry, err := EntrypointPath(body.Entrypoint)
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, err.Error())
	}
	if run.Status == "queued" || run.Status == "running" {
		return httpx.Errorf(http.StatusConflict, "the agents are working on this run; wait for a checkpoint (or pause it) before running code yourself")
	}
	if s.activeHeal(ctx, run.ID) {
		return httpx.Errorf(http.StatusConflict, "the debugger is fixing this run; wait for it to finish")
	}
	project := s.ProjectDir(run.WorkspaceID, run.ID)
	full, err := ResolveNoSymlink(project, entry)
	if err != nil {
		return httpx.ErrForbidden
	}
	if st, err := os.Stat(full); err != nil || !st.Mode().IsRegular() {
		return httpx.Errorf(http.StatusNotFound, entry+" does not exist in this run's project")
	}
	pctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if err := s.engine.Runner.Ping(pctx); err != nil {
		return httpx.Errorf(http.StatusServiceUnavailable, "Docker is not available, so code cannot run. Start Docker and try again. ("+err.Error()+")")
	}
	if ok, err := s.engine.Runner.ImagePresent(pctx, s.cfg.SandboxImagePython); err == nil && !ok {
		return httpx.Errorf(http.StatusServiceUnavailable, fmt.Sprintf("the sandbox image %s is not built (docker build -t %s infra/sandbox-images/python)",
			s.cfg.SandboxImagePython, s.cfg.SandboxImagePython))
	}

	j := &job{run: run, phase: "execute", agent: "researcher", source: "user", userID: auth.UserID(ctx), entrypoint: entry,
		image: s.cfg.SandboxImagePython, timeout: s.timeout(body.TimeoutSec), env: map[string]string{}}
	if strings.HasPrefix(entry, "tests/") {
		j.phase = "test"
		j.argv = []string{"python", "-m", "pytest", "-q", "-p", "no:cacheprovider", entry}
		j.env["PYTHONPATH"] = "/work/src"
	} else {
		j.collect = true
		j.argv = []string{"python", "-u", entry}
	}
	j.command = joinArgv(j.argv)

	unlock, ok := s.tryLockRun(run.ID)
	if !ok {
		return httpx.Errorf(http.StatusConflict, "an execution is already running for this run")
	}
	execID, err := s.insertExec(ctx, j)
	if err != nil {
		unlock()
		return err
	}
	runCtx, cancelRun := context.WithCancelCause(s.serverCtx())
	s.register(execID, run.ID, cancelRun) // registered before returning, so cancel works at once
	go func() {
		defer unlock()
		defer cancelRun(nil)
		s.execute(runCtx, cancelRun, j, execID)
	}()
	view, err := s.loadExec(context.WithoutCancel(ctx), execID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusAccepted, view)
	return nil
}

func joinArgv(a []string) string {
	out := ""
	for i, s := range a {
		if i > 0 {
			out += " "
		}
		out += s
	}
	return out
}

// ExecView is an execution as the browser sees it.
type ExecView struct {
	ID            int64           `json:"id"`
	RunID         int64           `json:"run_id"`
	Phase         string          `json:"phase"`
	Status        string          `json:"status"`
	Source        string          `json:"source"`
	Agent         string          `json:"agent"`
	Attempt       int             `json:"attempt"`
	Entrypoint    string          `json:"entrypoint"`
	Command       string          `json:"command"`
	ExitCode      *int            `json:"exit_code"`
	TimedOut      bool            `json:"timed_out"`
	Cancelled     bool            `json:"cancelled"`
	DurationMs    int64           `json:"duration_ms"`
	StartedAt     time.Time       `json:"started_at"`
	FinishedAt    *time.Time      `json:"finished_at"`
	LogPath       string          `json:"log_path"`
	StderrPath    string          `json:"stderr_path"`
	LogHash       string          `json:"log_hash"`
	CodeVersion   string          `json:"code_version"`
	Error         string          `json:"error"`
	MetricsStatus string          `json:"metrics_status"`
	MetricsError  string          `json:"metrics_error"`
	Artifacts     json.RawMessage `json:"artifacts"`
	Limits        json.RawMessage `json:"limits"`
	Metrics       []MetricOut     `json:"metrics,omitempty"`
	workspaceID   int64
}

const execCols = `e.id, e.run_id, e.phase, e.status, e.source, e.agent, e.attempt, e.entrypoint, e.command, e.exit_code,
	e.timed_out, e.cancelled, e.duration_ms, e.started_at, e.finished_at, e.log_path, e.stderr_path, e.log_hash,
	e.code_version, e.error, e.metrics_status, e.metrics_error, e.artifacts, e.limits, r.workspace_id`

func scanExec(row interface{ Scan(...any) error }) (*ExecView, error) {
	v := &ExecView{}
	err := row.Scan(&v.ID, &v.RunID, &v.Phase, &v.Status, &v.Source, &v.Agent, &v.Attempt, &v.Entrypoint, &v.Command,
		&v.ExitCode, &v.TimedOut, &v.Cancelled, &v.DurationMs, &v.StartedAt, &v.FinishedAt, &v.LogPath, &v.StderrPath,
		&v.LogHash, &v.CodeVersion, &v.Error, &v.MetricsStatus, &v.MetricsError, &v.Artifacts, &v.Limits, &v.workspaceID)
	if err != nil {
		return nil, notFound(err)
	}
	return v, nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return store.ErrNotFound
	}
	return err
}

func (s *Service) loadExec(ctx context.Context, id int64) (*ExecView, error) {
	return scanExec(s.store.Pool.QueryRow(ctx, `SELECT `+execCols+` FROM sandbox_execs e JOIN runs r ON r.id=e.run_id WHERE e.id=$1`, id))
}

func (s *Service) LoadExec(ctx context.Context, id int64) (*ExecView, error) {
	return s.loadExec(ctx, id)
}

// execFor loads an execution and checks the user's role in its workspace (404 for non-members).
func (s *Service) execFor(r *http.Request, minRole string) (*ExecView, error) {
	id, err := httpx.IDParam(r, "execId")
	if err != nil {
		return nil, err
	}
	v, err := s.loadExec(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if _, err := workspace.Access(r.Context(), s.store, v.workspaceID, minRole); err != nil {
		return nil, err
	}
	return v, nil
}

// GET /runs/{id}/sandbox/executions â€” every attempt (agent and researcher), newest first.
func (s *Service) ListExecutions(w http.ResponseWriter, r *http.Request) error {
	run, err := s.runFor(r, "viewer")
	if err != nil {
		return err
	}
	rows, err := s.store.Pool.Query(r.Context(), `SELECT `+execCols+` FROM sandbox_execs e JOIN runs r ON r.id=e.run_id
		WHERE e.run_id=$1 ORDER BY e.id DESC LIMIT 200`, run.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []*ExecView{}
	for rows.Next() {
		v, err := scanExec(rows)
		if err != nil {
			return err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// GET /sandbox/executions/{execId} â€” status, exit code, duration, validated metrics and artifacts.
func (s *Service) GetExecution(w http.ResponseWriter, r *http.Request) error {
	v, err := s.execFor(r, "viewer")
	if err != nil {
		return err
	}
	rows, err := s.store.Pool.Query(r.Context(), `SELECT id, name, value, log_line, log_line_text FROM metrics WHERE exec_id=$1 ORDER BY name`, v.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	v.Metrics = []MetricOut{}
	for rows.Next() {
		var m MetricOut
		if err := rows.Scan(&m.ID, &m.Name, &m.Value, &m.LogLine, &m.LogLineText); err != nil {
			return err
		}
		v.Metrics = append(v.Metrics, m)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

// GET /sandbox/executions/{execId}/logs?stream=combined|stderr&offset=0 â€” incremental log reads
// while the container runs (the browser polls; nothing is invented).
func (s *Service) ExecutionLogs(w http.ResponseWriter, r *http.Request) error {
	v, err := s.execFor(r, "viewer")
	if err != nil {
		return err
	}
	rel := fmt.Sprintf("logs/%s-%d.log", v.Phase, v.ID)
	if r.URL.Query().Get("stream") == "stderr" {
		rel = fmt.Sprintf("logs/%s-%d.stderr.log", v.Phase, v.ID)
	}
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if offset < 0 {
		offset = 0
	}
	run, err := s.store.RunByID(r.Context(), v.RunID)
	if err != nil {
		return err
	}
	complete := v.Status != "running" && v.Status != "queued"
	out := map[string]any{"content": "", "offset": offset, "next_offset": offset, "size": 0, "complete": complete, "status": v.Status}
	full, err := ResolveNoSymlink(s.ProjectDir(run.WorkspaceID, run.ID), rel)
	if err != nil {
		return httpx.ErrForbidden
	}
	f, err := os.Open(full)
	if err != nil {
		httpx.JSON(w, http.StatusOK, out)
		return nil
	}
	defer f.Close()
	st, _ := f.Stat()
	size := st.Size()
	if offset > size {
		offset = size
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return err
	}
	buf := make([]byte, min(size-offset, maxLogChunk))
	n, _ := io.ReadFull(f, buf)
	buf = buf[:n]
	// Never split a UTF-8 character across chunks.
	for len(buf) > 0 && !utf8.Valid(buf) && n-len(buf) < 4 {
		buf = buf[:len(buf)-1]
	}
	out["content"] = string(buf)
	out["offset"] = offset
	out["next_offset"] = offset + int64(len(buf))
	out["size"] = size
	out["complete"] = complete && offset+int64(len(buf)) >= size
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// POST /sandbox/executions/{execId}/cancel â€” kills the container (it is then removed).
func (s *Service) CancelExecution(w http.ResponseWriter, r *http.Request) error {
	v, err := s.execFor(r, "editor")
	if err != nil {
		return err
	}
	if v.Status != "running" && v.Status != "queued" {
		return httpx.Errorf(http.StatusConflict, "execution is already "+v.Status)
	}
	if !s.CancelExec(v.ID) {
		return httpx.Errorf(http.StatusConflict, "execution is not running on this server")
	}
	s.bus.Emit(r.Context(), store.Event{RunID: v.RunID, Agent: "researcher", Type: "sandbox_cancel_requested",
		Message: fmt.Sprintf("Researcher cancelled sandbox execution #%d", v.ID), Why: "Stop button in the code sandbox",
		Links: mustJSON(map[string]any{"exec_id": v.ID})})
	httpx.JSON(w, http.StatusAccepted, map[string]any{"id": v.ID, "status": "cancelling"})
	return nil
}

// GET /runs/{id}/artifact?path=models/model.pt â€” downloads a result or model artifact.
func (s *Service) DownloadArtifact(w http.ResponseWriter, r *http.Request) error {
	run, err := s.runFor(r, "viewer")
	if err != nil {
		return err
	}
	rel, err := ArtifactRel(r.URL.Query().Get("path"))
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, err.Error())
	}
	full, err := ResolveNoSymlink(s.ProjectDir(run.WorkspaceID, run.ID), rel)
	if err != nil {
		return httpx.ErrForbidden
	}
	st, err := os.Lstat(full)
	if errors.Is(err, os.ErrNotExist) {
		return store.ErrNotFound
	}
	if err != nil || !st.Mode().IsRegular() {
		return httpx.ErrForbidden
	}
	if st.Size() > s.cfg.SandboxMaxArtifactMB<<20 {
		return httpx.Errorf(http.StatusRequestEntityTooLarge, "artifact is larger than the download limit")
	}
	f, err := os.Open(full)
	if err != nil {
		return err
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox")
	h.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", path.Base(rel)))
	http.ServeContent(w, r, path.Base(rel), st.ModTime(), f)
	return nil
}
