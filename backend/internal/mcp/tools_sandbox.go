package mcp

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/ryuma04/tapu-sena/backend/internal/runs"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type SandboxExecuteIn struct {
	RunID      int64    `json:"run_id"`
	Entrypoint string   `json:"entrypoint,omitempty" jsonschema:"e.g. src/train.py; defaults to src/train.py"`
	Args       []string `json:"args,omitempty" jsonschema:"optional CLI arguments"`
	TimeoutSec int      `json:"timeout_sec,omitempty" jsonschema:"execution timeout in seconds, max 600"`
}

type SandboxGetStatusIn struct {
	ExecID int64 `json:"exec_id"`
}

type SandboxGetLogsIn struct {
	ExecID int64  `json:"exec_id"`
	Offset int64  `json:"offset,omitempty" jsonschema:"byte offset for incremental streaming"`
	Stream string `json:"stream,omitempty" jsonschema:"combined | stderr"`
}

type SandboxListArtifactsIn struct {
	RunID int64 `json:"run_id"`
}

type SandboxRunTestsIn struct {
	RunID      int64 `json:"run_id"`
	TimeoutSec int   `json:"timeout_sec,omitempty"`
}

type SandboxCancelIn struct {
	ExecID int64 `json:"exec_id"`
}

func (s *Server) handleSandboxExecute(ctx context.Context, in SandboxExecuteIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	entry := strings.TrimSpace(in.Entrypoint)
	if entry == "" {
		entry = "src/train.py"
	}
	cleanEntry, err := sandbox.EntrypointPath(entry)
	if err != nil {
		return nil, fmt.Errorf("invalid entrypoint: %w", err)
	}

	// Verify entrypoint exists
	projectDir := s.projectDir(run.ID)
	fullPath := filepath.Join(projectDir, filepath.FromSlash(cleanEntry))
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("entrypoint file does not exist: %s", cleanEntry)
	}

	timeoutSec := in.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 180
	}
	if timeoutSec > 600 {
		timeoutSec = 600
	}

	command := "python -u " + cleanEntry
	if len(in.Args) > 0 {
		command += " " + strings.Join(in.Args, " ")
	}

	collectMetrics := true
	req := sandbox.ExecRequest{
		RunID:          run.ID,
		Phase:          "execute",
		Command:        command,
		TimeoutSec:     timeoutSec,
		Image:          "python",
		Agent:          "researcher",
		CollectMetrics: &collectMetrics,
		Attempt:        1,
	}

	res, err := s.sandbox.Exec(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("sandbox execution failed: %w", err)
	}

	// Emit event for real-time live UI updates
	s.bus.Emit(ctx, store.Event{
		RunID:   run.ID,
		Agent:   "sandbox",
		Type:    "sandbox_exec_completed",
		Message: fmt.Sprintf("Executed %s (status: %s, exit: %v, time: %dms)", cleanEntry, res.Status, res.ExitCode, res.DurationMs),
		Why:     "MCP tool sandbox_execute",
		Links:   mustJSON(map[string]any{"exec_id": res.ExecID, "status": res.Status}),
	})

	return map[string]any{
		"exec_id":        res.ExecID,
		"run_id":         run.ID,
		"entrypoint":     cleanEntry,
		"command":        command,
		"status":         res.Status,
		"exit_code":      res.ExitCode,
		"duration_ms":    res.DurationMs,
		"timed_out":      res.TimedOut,
		"cancelled":      res.Cancelled,
		"log_path":       res.LogPath,
		"metrics_status": res.MetricsStatus,
		"error":          res.Error,
	}, nil
}

func (s *Server) handleSandboxGetStatus(ctx context.Context, in SandboxGetStatusIn) (any, error) {
	v, err := s.sandbox.LoadExec(ctx, in.ExecID)
	if err != nil {
		return nil, fmt.Errorf("execution %d not found: %w", in.ExecID, err)
	}

	return map[string]any{
		"exec_id":        v.ID,
		"run_id":         v.RunID,
		"phase":          v.Phase,
		"status":         v.Status,
		"agent":          v.Agent,
		"entrypoint":     v.Entrypoint,
		"command":        v.Command,
		"exit_code":      v.ExitCode,
		"timed_out":      v.TimedOut,
		"cancelled":      v.Cancelled,
		"duration_ms":    v.DurationMs,
		"started_at":     v.StartedAt,
		"finished_at":    v.FinishedAt,
		"error":          v.Error,
		"metrics_status": v.MetricsStatus,
		"metrics_error":  v.MetricsError,
		"metrics":        v.Metrics,
	}, nil
}

func (s *Server) handleSandboxGetLogs(ctx context.Context, in SandboxGetLogsIn) (any, error) {
	v, err := s.sandbox.LoadExec(ctx, in.ExecID)
	if err != nil {
		return nil, fmt.Errorf("execution %d not found: %w", in.ExecID, err)
	}

	rel := fmt.Sprintf("logs/%s-%d.log", v.Phase, v.ID)
	if in.Stream == "stderr" {
		rel = fmt.Sprintf("logs/%s-%d.stderr.log", v.Phase, v.ID)
	}

	full := filepath.Join(s.projectDir(v.RunID), filepath.FromSlash(rel))
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}

	f, err := os.Open(full)
	if err != nil {
		return map[string]any{
			"exec_id":     in.ExecID,
			"content":     "",
			"offset":      offset,
			"next_offset": offset,
			"size":        0,
			"complete":    v.Status != "running" && v.Status != "queued",
		}, nil
	}
	defer f.Close()

	st, _ := f.Stat()
	size := st.Size()
	if offset > size {
		offset = size
	}
	_, _ = f.Seek(offset, io.SeekStart)

	const maxChunk = 64 << 10 // 64 KB
	buf := make([]byte, min(size-offset, maxChunk))
	n, _ := io.ReadFull(f, buf)
	buf = buf[:n]

	for len(buf) > 0 && !utf8.Valid(buf) && n-len(buf) < 4 {
		buf = buf[:len(buf)-1]
	}

	return map[string]any{
		"exec_id":     in.ExecID,
		"content":     string(buf),
		"offset":      offset,
		"next_offset": offset + int64(len(buf)),
		"size":        size,
		"complete":    (v.Status != "running" && v.Status != "queued") && (offset+int64(len(buf)) >= size),
		"status":      v.Status,
	}, nil
}

func (s *Server) handleSandboxListArtifacts(ctx context.Context, in SandboxListArtifactsIn) (any, error) {
	_, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	projectDir := s.projectDir(in.RunID)
	type ArtifactItem struct {
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		Category string `json:"category"`
	}

	artifacts := make([]ArtifactItem, 0)
	for _, folder := range []string{"results", "models"} {
		fPath := filepath.Join(projectDir, folder)
		_ = filepath.WalkDir(fPath, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(projectDir, p)
			if err != nil {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			artifacts = append(artifacts, ArtifactItem{
				Path:     filepath.ToSlash(rel),
				Size:     info.Size(),
				Category: folder,
			})
			return nil
		})
	}

	return map[string]any{
		"run_id":          in.RunID,
		"artifacts":       artifacts,
		"artifacts_count": len(artifacts),
	}, nil
}

func (s *Server) handleSandboxRunTests(ctx context.Context, in SandboxRunTestsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	timeoutSec := in.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 120
	}

	req := sandbox.ExecRequest{
		RunID:      run.ID,
		Phase:      "test",
		Command:    "python -m pytest -q -p no:cacheprovider --junitxml=results/junit.xml tests",
		TimeoutSec: timeoutSec,
		Image:      "python",
		Agent:      "testing.runner",
		Env:        map[string]string{"PYTHONPATH": "/work/src"},
		Attempt:    1,
	}

	execRes, err := s.sandbox.Exec(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed executing tests in sandbox: %w", err)
	}

	// Parse junit report
	junitPath := filepath.Join(s.projectDir(run.ID), "results", "junit.xml")
	var testCases any
	if data, err := os.ReadFile(junitPath); err == nil {
		if parsed, perr := runs.ParseJUnit(data); perr == nil {
			testCases = parsed
		}
	}

	return map[string]any{
		"exec_id":     execRes.ExecID,
		"run_id":      run.ID,
		"status":      execRes.Status,
		"exit_code":   execRes.ExitCode,
		"duration_ms": execRes.DurationMs,
		"tests":       testCases,
	}, nil
}

func (s *Server) handleSandboxCancel(ctx context.Context, in SandboxCancelIn) (any, error) {
	cancelled := s.sandbox.CancelExec(in.ExecID)
	return map[string]any{
		"exec_id":   in.ExecID,
		"cancelled": cancelled,
		"message":   fmt.Sprintf("Execution %d cancellation requested (success: %v)", in.ExecID, cancelled),
	}, nil
}
