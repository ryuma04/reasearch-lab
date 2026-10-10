package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type DebuggerInspectErrorIn struct {
	ExecID int64 `json:"exec_id"`
}

type DebuggerProposePatchIn struct {
	ExecID int64 `json:"exec_id"`
}

type DebuggerApplyAndRerunIn struct {
	ExecID      int64  `json:"exec_id"`
	FilePath    string `json:"file_path,omitempty" jsonschema:"e.g. src/train.py"`
	PatchCode   string `json:"patch_code,omitempty" jsonschema:"new full file content or patched section"`
	Explanation string `json:"explanation,omitempty"`
}

type DebuggerGetHealStatusIn struct {
	RunID int64 `json:"run_id"`
}

var tracebackRe = regexp.MustCompile(`File "([^"]+)", line (\d+), in (\w+)\n\s*(.*?)\n([A-Za-z0-9_]+Error.*|Exception.*)`)

func (s *Server) handleDebuggerInspectError(ctx context.Context, in DebuggerInspectErrorIn) (any, error) {
	v, err := s.sandbox.LoadExec(ctx, in.ExecID)
	if err != nil {
		return nil, fmt.Errorf("execution %d not found: %w", in.ExecID, err)
	}

	projectDir := s.projectDir(v.RunID)
	stderrPath := filepath.Join(projectDir, fmt.Sprintf("logs/%s-%d.stderr.log", v.Phase, v.ID))
	logPath := filepath.Join(projectDir, fmt.Sprintf("logs/%s-%d.log", v.Phase, v.ID))

	errText := ""
	if data, err := os.ReadFile(stderrPath); err == nil && len(data) > 0 {
		errText = string(data)
	} else if data, err := os.ReadFile(logPath); err == nil && len(data) > 0 {
		errText = string(data)
	}
	if errText == "" {
		errText = v.Error
	}

	// Extract last 4KB if large
	if len(errText) > 4096 {
		errText = errText[len(errText)-4096:]
	}

	errorKind := "UnknownError"
	failingFile := v.Entrypoint
	failingLine := 0
	errorSummary := "Execution failed"

	lines := strings.Split(errText, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if strings.Contains(l, "Error:") || strings.Contains(l, "Exception:") {
			errorSummary = l
			parts := strings.SplitN(l, ":", 2)
			errorKind = parts[0]
			break
		}
	}

	matches := tracebackRe.FindAllStringSubmatch(errText, -1)
	if len(matches) > 0 {
		last := matches[len(matches)-1]
		failingFile = last[1]
		_, _ = fmt.Sscanf(last[2], "%d", &failingLine)
	}

	return map[string]any{
		"exec_id":       v.ID,
		"run_id":        v.RunID,
		"status":        v.Status,
		"exit_code":     v.ExitCode,
		"error_kind":    errorKind,
		"error_summary": errorSummary,
		"failing_file":  failingFile,
		"failing_line":  failingLine,
		"stderr_tail":   errText,
	}, nil
}

func (s *Server) handleDebuggerProposePatch(ctx context.Context, in DebuggerProposePatchIn) (any, error) {
	v, err := s.sandbox.LoadExec(ctx, in.ExecID)
	if err != nil {
		return nil, fmt.Errorf("execution %d not found: %w", in.ExecID, err)
	}

	// 1. Search Lab Memory first for previous matching fix
	inspectRes, _ := s.handleDebuggerInspectError(ctx, DebuggerInspectErrorIn{ExecID: in.ExecID})
	inspectMap, _ := inspectRes.(map[string]any)
	errSummary, _ := inspectMap["error_summary"].(string)

	var memoryFix any
	if errSummary != "" {
		var memID int64
		var memTitle, memContent string
		err := s.store.Pool.QueryRow(ctx, `
			SELECT id, title, content::text
			FROM memory_items
			WHERE kind = 'error_fix' AND (lower(title) LIKE '%' || lower($1) || '%' OR lower(content::text) LIKE '%' || lower($1) || '%')
			ORDER BY id DESC LIMIT 1`, strings.TrimSpace(errSummary)).Scan(&memID, &memTitle, &memContent)
		if err == nil {
			memoryFix = map[string]any{"memory_id": memID, "title": memTitle, "content": memContent}
		}
	}

	// 2. Identify deterministic fixes for common machine learning failure modes
	deterministicFix := ""
	explanation := ""
	if strings.Contains(errSummary, "ModuleNotFoundError: No module named 'torch'") || strings.Contains(errSummary, "ModuleNotFoundError") {
		deterministicFix = "# Ensure dependency is installed in requirements.txt"
		explanation = "Missing Python module dependency detected."
	} else if strings.Contains(errSummary, "CUDA out of memory") {
		deterministicFix = "batch_size = max(1, batch_size // 2)"
		explanation = "Out of memory detected; reduce batch size or enable gradient accumulation."
	} else if strings.Contains(errSummary, "Expected all tensors to be on the same device") {
		deterministicFix = "tensor = tensor.to(device)"
		explanation = "Device mismatch (CPU vs GPU); explicitly route tensors to target device."
	}

	return map[string]any{
		"exec_id":           v.ID,
		"run_id":            v.RunID,
		"entrypoint":        v.Entrypoint,
		"memory_fix":        memoryFix,
		"deterministic_fix": deterministicFix,
		"explanation":       explanation,
		"failing_file":      inspectMap["failing_file"],
	}, nil
}

func (s *Server) handleDebuggerApplyAndRerun(ctx context.Context, in DebuggerApplyAndRerunIn) (any, error) {
	v, err := s.sandbox.LoadExec(ctx, in.ExecID)
	if err != nil {
		return nil, fmt.Errorf("execution %d not found: %w", in.ExecID, err)
	}

	// Check existing heal attempts for this run to enforce maximum 3 repair attempts
	var attemptCount int
	_ = s.store.Pool.QueryRow(ctx, `
		SELECT count(*) FROM repair_attempts ra
		JOIN heal_sessions hs ON hs.id = ra.session_id
		WHERE hs.run_id = $1`, v.RunID).Scan(&attemptCount)

	if attemptCount >= sandbox.MaxHealAttempts {
		return nil, fmt.Errorf("maximum repair attempts reached (%d/%d); human researcher intervention required",
			attemptCount, sandbox.MaxHealAttempts)
	}

	attemptNum := attemptCount + 1

	// Apply patch if provided
	if in.FilePath != "" && in.PatchCode != "" {
		cleanPath, err := sandbox.EditablePath(in.FilePath)
		if err != nil {
			return nil, fmt.Errorf("invalid patch file path: %w", err)
		}
		target := filepath.Join(s.projectDir(v.RunID), filepath.FromSlash(cleanPath))
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		if err := os.WriteFile(target, []byte(in.PatchCode), 0o644); err != nil {
			return nil, fmt.Errorf("failed applying patch: %w", err)
		}
	}

	// Create heal session if not present
	var sessionID int64
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO heal_sessions (run_id, user_id, source_exec_id, entrypoint, max_attempts, status)
		VALUES ($1, $2, $3, $4, $5, 'running')
		RETURNING id`, v.RunID, s.user.ID, v.ID, v.Entrypoint, sandbox.MaxHealAttempts).Scan(&sessionID)
	if err != nil {
		// Session may already exist
		_ = s.store.Pool.QueryRow(ctx, `SELECT id FROM heal_sessions WHERE run_id=$1 ORDER BY id DESC LIMIT 1`, v.RunID).Scan(&sessionID)
	}

	// Re-run in fresh sandbox
	command := "python -u " + v.Entrypoint
	collectMetrics := true
	execReq := sandbox.ExecRequest{
		RunID:          v.RunID,
		Phase:          "execute",
		Command:        command,
		TimeoutSec:     180,
		Image:          "python",
		Agent:          "debugger",
		CollectMetrics: &collectMetrics,
		Attempt:        attemptNum,
	}

	newExec, err := s.sandbox.Exec(ctx, execReq)
	if err != nil {
		return nil, fmt.Errorf("sandbox re-execution failed: %w", err)
	}

	status := "failed"
	if newExec.Status == "succeeded" {
		status = "fixed"
	}

	// Record attempt
	_, _ = s.store.Pool.Exec(ctx, `
		INSERT INTO repair_attempts (session_id, attempt, error_kind, error_summary, explanation, diff, exec_id, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		sessionID, attemptNum, "SelfHealingAttempt", "Attempt "+fmt.Sprint(attemptNum), in.Explanation,
		in.FilePath, newExec.ExecID, status)

	if status == "fixed" {
		_, _ = s.store.Pool.Exec(ctx, `UPDATE heal_sessions SET status='fixed', finished_at=now() WHERE id=$1`, sessionID)
	}

	// Emit bus event
	s.bus.Emit(ctx, store.Event{
		RunID:   v.RunID,
		Agent:   "debugger",
		Type:    "heal_attempt_finished",
		Message: fmt.Sprintf("Repair attempt %d/%d %s (status: %s)", attemptNum, sandbox.MaxHealAttempts, status, newExec.Status),
		Why:     "MCP tool debugger_apply_and_rerun",
		Links:   mustJSON(map[string]any{"session_id": sessionID, "attempt": attemptNum, "exec_id": newExec.ExecID, "status": status}),
	})

	return map[string]any{
		"session_id":   sessionID,
		"attempt":      attemptNum,
		"max_attempts": sandbox.MaxHealAttempts,
		"status":       status,
		"exec_id":      newExec.ExecID,
		"exit_code":    newExec.ExitCode,
		"duration_ms":  newExec.DurationMs,
		"fixed":        status == "fixed",
	}, nil
}

func (s *Server) handleDebuggerGetHealStatus(ctx context.Context, in DebuggerGetHealStatusIn) (any, error) {
	rows, err := s.store.Pool.Query(ctx, `
		SELECT hs.id, hs.run_id, hs.status, hs.max_attempts, coalesce(hs.message, ''), hs.created_at, hs.finished_at
		FROM heal_sessions hs
		WHERE hs.run_id = $1
		ORDER BY hs.id DESC LIMIT 5`, in.RunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type SessionView struct {
		ID          int64           `json:"id"`
		RunID       int64           `json:"run_id"`
		Status      string          `json:"status"`
		MaxAttempts int             `json:"max_attempts"`
		Message     string          `json:"message"`
		CreatedAt   any             `json:"created_at"`
		FinishedAt  any             `json:"finished_at"`
		Attempts    json.RawMessage `json:"attempts"`
	}

	sessions := make([]SessionView, 0)
	for rows.Next() {
		var sView SessionView
		if err := rows.Scan(&sView.ID, &sView.RunID, &sView.Status, &sView.MaxAttempts, &sView.Message, &sView.CreatedAt, &sView.FinishedAt); err == nil {
			// Fetch attempts
			aRows, _ := s.store.Pool.Query(ctx, `
				SELECT id, attempt, error_kind, error_summary, explanation, diff, exec_id, status, created_at
				FROM repair_attempts WHERE session_id=$1 ORDER BY attempt ASC`, sView.ID)
			type AttemptItem struct {
				ID           int64  `json:"id"`
				Attempt      int    `json:"attempt"`
				ErrorKind    string `json:"error_kind"`
				ErrorSummary string `json:"error_summary"`
				Explanation  string `json:"explanation"`
				Diff         string `json:"diff"`
				ExecID       *int64 `json:"exec_id"`
				Status       string `json:"status"`
			}
			atts, _ := pgx.CollectRows(aRows, func(row pgx.CollectableRow) (AttemptItem, error) {
				var a AttemptItem
				var dummyCreatedAt any
				err := row.Scan(&a.ID, &a.Attempt, &a.ErrorKind, &a.ErrorSummary, &a.Explanation, &a.Diff, &a.ExecID, &a.Status, &dummyCreatedAt)
				return a, err
			})
			bytes, _ := json.Marshal(atts)
			sView.Attempts = bytes
			sessions = append(sessions, sView)
		}
	}

	return map[string]any{
		"run_id":        in.RunID,
		"heal_sessions": sessions,
	}, nil
}
