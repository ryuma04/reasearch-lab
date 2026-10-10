package sandbox

// Self-Healing Debugger API. The repair loop itself runs in the Python agent worker (it owns the
// AI calls); Go validates the request, records the session and queues a "heal" job on the
// existing Redis queue. Patched code is always re-run through this package's sandbox.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// MaxHealAttempts is the automatic repair limit per session.
const MaxHealAttempts = 3

type HealAttempt struct {
	ID           int64           `json:"id"`
	Attempt      int             `json:"attempt"`
	ErrorKind    string          `json:"error_kind"`
	ErrorSummary string          `json:"error_summary"`
	ErrorText    string          `json:"error_text"`
	FixSource    string          `json:"fix_source"`
	Explanation  string          `json:"explanation"`
	Diff         string          `json:"diff"`
	Files        json.RawMessage `json:"files"`
	ExecID       *int64          `json:"exec_id"`
	TestExecID   *int64          `json:"test_exec_id"`
	Tests        json.RawMessage `json:"tests"`
	Status       string          `json:"status"`
	CreatedAt    time.Time       `json:"created_at"`
}

type HealSession struct {
	ID           int64         `json:"id"`
	RunID        int64         `json:"run_id"`
	SourceExecID *int64        `json:"source_exec_id"`
	Entrypoint   string        `json:"entrypoint"`
	Status       string        `json:"status"` // queued | running | fixed | failed | error
	MaxAttempts  int           `json:"max_attempts"`
	Message      string        `json:"message"`
	Tokens       int           `json:"tokens"`
	CreatedAt    time.Time     `json:"created_at"`
	FinishedAt   *time.Time    `json:"finished_at"`
	Attempts     []HealAttempt `json:"attempts"`
}

func (s *Service) activeHeal(ctx context.Context, runID int64) bool {
	var ok bool
	_ = s.store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM heal_sessions WHERE run_id=$1 AND status IN ('queued','running'))`, runID).Scan(&ok)
	return ok
}

// POST /runs/{id}/sandbox/heal {"exec_id": 41} — Fix with AI for a failed execution.
func (s *Service) StartHeal(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	run, err := s.runFor(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		ExecID int64 `json:"exec_id"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if run.Status == "queued" || run.Status == "running" {
		return httpx.Errorf(http.StatusConflict, "the agents are working on this run; their own debugger is already repairing it")
	}
	ex, err := s.loadExec(ctx, body.ExecID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && ex.RunID != run.ID) {
		return httpx.Errorf(http.StatusNotFound, "execution not found in this run")
	}
	if err != nil {
		return err
	}
	switch ex.Status {
	case "failed", "timed_out":
	case "error":
		return httpx.Errorf(http.StatusConflict, "this was a sandbox problem, not a code bug: "+ex.Error)
	case "running", "queued":
		return httpx.Errorf(http.StatusConflict, "wait for the execution to finish")
	default:
		return httpx.Errorf(http.StatusConflict, "only failed or timed out executions can be fixed (this one is "+ex.Status+")")
	}
	entry := ex.Entrypoint
	if entry == "" {
		entry = strings.TrimPrefix(ex.Command, "python ")
	}
	if _, err := EntrypointPath(entry); err != nil {
		entry = "src/train.py"
	}
	if _, active := s.runningOn(run.ID); active {
		return httpx.Errorf(http.StatusConflict, "an execution is running for this run")
	}
	var sess HealSession
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO heal_sessions (run_id, user_id, source_exec_id, entrypoint, max_attempts) VALUES ($1,$2,$3,$4,$5)
		RETURNING id, run_id, source_exec_id, entrypoint, status, max_attempts, message, tokens, created_at, finished_at`,
		run.ID, auth.UserID(ctx), ex.ID, entry, MaxHealAttempts).Scan(&sess.ID, &sess.RunID, &sess.SourceExecID,
		&sess.Entrypoint, &sess.Status, &sess.MaxAttempts, &sess.Message, &sess.Tokens, &sess.CreatedAt, &sess.FinishedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httpx.Errorf(http.StatusConflict, "a fix is already in progress for this run")
	}
	if err != nil {
		return err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "heal", "run_id": run.ID, "session_id": sess.ID}); err != nil {
		_, _ = s.store.Pool.Exec(context.WithoutCancel(ctx), `DELETE FROM heal_sessions WHERE id=$1`, sess.ID)
		return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
	}
	s.bus.Emit(ctx, store.Event{RunID: run.ID, Agent: "researcher", Type: "heal_requested",
		Message: "Researcher asked the debugger to fix the failed run", Why: "Fix with AI in the code sandbox",
		Links: mustJSON(map[string]any{"session_id": sess.ID, "exec_id": ex.ID})})
	sess.Attempts = []HealAttempt{}
	httpx.JSON(w, http.StatusAccepted, sess)
	return nil
}

// runningOn reports whether an execution is in progress for the run on this server.
func (s *Service) runningOn(runID int64) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, a := range s.active {
		if a.runID == runID {
			return id, true
		}
	}
	return 0, false
}

// GET /runs/{id}/sandbox/heal — the latest repair sessions with every attempt.
func (s *Service) ListHeal(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	run, err := s.runFor(r, "viewer")
	if err != nil {
		return err
	}
	rows, err := s.store.Pool.Query(ctx, `SELECT id, run_id, source_exec_id, entrypoint, status, max_attempts, message, tokens,
		created_at, finished_at FROM heal_sessions WHERE run_id=$1 ORDER BY id DESC LIMIT 10`, run.ID)
	if err != nil {
		return err
	}
	sessions, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (HealSession, error) {
		var h HealSession
		err := row.Scan(&h.ID, &h.RunID, &h.SourceExecID, &h.Entrypoint, &h.Status, &h.MaxAttempts, &h.Message, &h.Tokens,
			&h.CreatedAt, &h.FinishedAt)
		h.Attempts = []HealAttempt{}
		return h, err
	})
	if err != nil {
		return err
	}
	for i := range sessions {
		arows, err := s.store.Pool.Query(ctx, `SELECT id, attempt, error_kind, error_summary, error_text, fix_source, explanation,
			diff, files, exec_id, test_exec_id, tests, status, created_at FROM repair_attempts WHERE session_id=$1 ORDER BY attempt`, sessions[i].ID)
		if err != nil {
			return err
		}
		atts, err := pgx.CollectRows(arows, func(row pgx.CollectableRow) (HealAttempt, error) {
			var a HealAttempt
			err := row.Scan(&a.ID, &a.Attempt, &a.ErrorKind, &a.ErrorSummary, &a.ErrorText, &a.FixSource, &a.Explanation,
				&a.Diff, &a.Files, &a.ExecID, &a.TestExecID, &a.Tests, &a.Status, &a.CreatedAt)
			return a, err
		})
		if err != nil {
			return err
		}
		sessions[i].Attempts = atts
	}
	httpx.JSON(w, http.StatusOK, sessions)
	return nil
}
