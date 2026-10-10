package store

import (
	"context"
	"errors"
	"encoding/json"
	"fmt"
	"time"
)

type Run struct {
	ID               int64           `json:"id"`
	WorkspaceID      int64           `json:"workspace_id"`
	ParentRunID      *int64          `json:"parent_run_id,omitempty"`
	Kind             string          `json:"kind"`
	BranchName       string          `json:"branch_name"`
	ComputeBudget    string          `json:"compute_budget"`
	Status           string          `json:"status"`
	Stage            string          `json:"stage"`
	SettingsOverride json.RawMessage `json:"settings_override"`
	Error            string          `json:"error,omitempty"`
	StartedAt        *time.Time      `json:"started_at,omitempty"`
	FinishedAt       *time.Time      `json:"finished_at,omitempty"`
	GitCommit        string          `json:"git_commit"`
	PrimaryMetric    string          `json:"primary_metric"`
	CreatedAt        time.Time       `json:"created_at"`
}

const runCols = `id, workspace_id, parent_run_id, kind, branch_name, compute_budget, status, stage,
	settings_override, error, started_at, finished_at, git_commit, primary_metric, created_at`

func scanRun(row interface{ Scan(...any) error }) (*Run, error) {
	r := &Run{}
	err := row.Scan(&r.ID, &r.WorkspaceID, &r.ParentRunID, &r.Kind, &r.BranchName, &r.ComputeBudget, &r.Status,
		&r.Stage, &r.SettingsOverride, &r.Error, &r.StartedAt, &r.FinishedAt, &r.GitCommit, &r.PrimaryMetric, &r.CreatedAt)
	return r, notFound(err)
}

func (s *Store) CreateRun(ctx context.Context, wsID int64, budget string) (*Run, error) {
	return scanRun(s.Pool.QueryRow(ctx, `
		INSERT INTO runs (workspace_id, compute_budget) VALUES ($1, $2) RETURNING `+runCols, wsID, budget))
}

// CreateRunIfIdle starts a main run unless the workspace already has one that is queued, running, waiting for approval
// or paused; in that case it returns that run (created == false). The workspace row is locked while it decides, so two
// clicks, two tabs or a retry after a timeout can never create two runs.
func (s *Store) CreateRunIfIdle(ctx context.Context, wsID int64, budget string) (run *Run, created bool, err error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	if _, err = tx.Exec(ctx, `SELECT 1 FROM workspaces WHERE id=$1 FOR UPDATE`, wsID); err != nil {
		return nil, false, err
	}
	active, err := scanRun(tx.QueryRow(ctx, `SELECT `+runCols+` FROM runs
		WHERE workspace_id=$1 AND kind='main' AND status IN ('queued','running','waiting_approval','paused') ORDER BY id DESC LIMIT 1`, wsID))
	if err == nil {
		return active, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	run, err = scanRun(tx.QueryRow(ctx, `INSERT INTO runs (workspace_id, compute_budget) VALUES ($1, $2) RETURNING `+runCols, wsID, budget))
	if err != nil {
		return nil, false, err
	}
	return run, true, tx.Commit(ctx)
}

func (s *Store) RunByID(ctx context.Context, id int64) (*Run, error) {
	return scanRun(s.Pool.QueryRow(ctx, `SELECT `+runCols+` FROM runs WHERE id=$1`, id))
}

func (s *Store) queryRuns(ctx context.Context, sql string, args ...any) ([]*Run, error) {
	rows, err := s.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) RunsForWorkspace(ctx context.Context, wsID int64) ([]*Run, error) {
	return s.queryRuns(ctx, `SELECT `+runCols+` FROM runs WHERE workspace_id=$1 AND parent_run_id IS NULL ORDER BY id DESC`, wsID)
}

func (s *Store) ChildRuns(ctx context.Context, parentID int64) ([]*Run, error) {
	return s.queryRuns(ctx, `SELECT `+runCols+` FROM runs WHERE parent_run_id=$1 ORDER BY id`, parentID)
}

// ActiveRunsForUser lists unfinished main runs in workspaces the user owns or edits (for voice commands).
func (s *Store) ActiveRunsForUser(ctx context.Context, userID int64) ([]*Run, error) {
	return s.queryRuns(ctx, `
		SELECT `+prefixed("r", runCols)+` FROM runs r
		JOIN workspace_members m ON m.workspace_id = r.workspace_id AND m.user_id=$1 AND m.role IN ('owner','editor')
		WHERE r.parent_run_id IS NULL
		ORDER BY (r.status IN ('running','waiting_approval','paused','queued')) DESC, r.id DESC LIMIT 5`, userID)
}

func (s *Store) SetRunStatus(ctx context.Context, id int64, status, stage, errMsg string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE runs SET status=$2, stage=COALESCE(NULLIF($3,''), stage), error=$4,
			finished_at = CASE WHEN $2 IN ('completed','failed','stopped','rejected') THEN now() ELSE finished_at END
		WHERE id=$1`, id, status, stage, errMsg)
	return err
}

// ---------- events ----------

type Event struct {
	ID      int64           `json:"id"`
	RunID   int64           `json:"run_id"`
	Time    time.Time       `json:"time"`
	Agent   string          `json:"agent"`
	Type    string          `json:"type"`
	Message string          `json:"message"`
	Why     string          `json:"why"`
	Links   json.RawMessage `json:"links"`
	Cost    json.RawMessage `json:"cost"`
}

func (s *Store) InsertEvent(ctx context.Context, e *Event) error {
	if len(e.Links) == 0 {
		e.Links = json.RawMessage(`{}`)
	}
	if len(e.Cost) == 0 {
		e.Cost = json.RawMessage(`{}`)
	}
	if e.Time.IsZero() {
		e.Time = time.Now()
	}
	return s.Pool.QueryRow(ctx, `
		INSERT INTO run_events (run_id, time, agent, type, message, why, links, cost)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		e.RunID, e.Time, e.Agent, e.Type, e.Message, e.Why, e.Links, e.Cost).Scan(&e.ID)
}

// EventsAfter returns events of a run (and, if includeChildren, its what-if/gap child runs) with id > after.
func (s *Store) EventsAfter(ctx context.Context, runID, after int64, limit int, includeChildren bool) ([]Event, error) {
	q := `SELECT id, run_id, time, agent, type, message, why, links, cost FROM run_events
		WHERE run_id = $1 AND id > $2 ORDER BY id LIMIT $3`
	if includeChildren {
		q = `SELECT id, run_id, time, agent, type, message, why, links, cost FROM run_events
		WHERE (run_id = $1 OR run_id IN (SELECT id FROM runs WHERE parent_run_id=$1)) AND id > $2 ORDER BY id LIMIT $3`
	}
	rows, err := s.Pool.Query(ctx, q, runID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.RunID, &e.Time, &e.Agent, &e.Type, &e.Message, &e.Why, &e.Links, &e.Cost); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------- checkpoints ----------

type Checkpoint struct {
	ID         int64           `json:"id"`
	RunID      int64           `json:"run_id"`
	Name       string          `json:"name"`
	Status     string          `json:"status"`
	Payload    json.RawMessage `json:"payload"`
	Response   json.RawMessage `json:"response"`
	CreatedAt  time.Time       `json:"created_at"`
	ResolvedAt *time.Time      `json:"resolved_at,omitempty"`
}

func (s *Store) Checkpoints(ctx context.Context, runID int64) ([]Checkpoint, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, run_id, name, status, payload, response, created_at, resolved_at
		FROM checkpoints WHERE run_id=$1 ORDER BY id`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Checkpoint{}
	for rows.Next() {
		var c Checkpoint
		if err := rows.Scan(&c.ID, &c.RunID, &c.Name, &c.Status, &c.Payload, &c.Response, &c.CreatedAt, &c.ResolvedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ResolveCheckpoint marks the pending checkpoint resolved. ErrNotFound if none is pending.
func (s *Store) ResolveCheckpoint(ctx context.Context, runID int64, name, status string, response any) (*Checkpoint, error) {
	resp, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	c := &Checkpoint{}
	err = s.Pool.QueryRow(ctx, `
		UPDATE checkpoints SET status=$3, response=$4, resolved_at=now()
		WHERE run_id=$1 AND name=$2 AND status='pending'
		RETURNING id, run_id, name, status, payload, response, created_at, resolved_at`, runID, name, status, resp).
		Scan(&c.ID, &c.RunID, &c.Name, &c.Status, &c.Payload, &c.Response, &c.CreatedAt, &c.ResolvedAt)
	return c, notFound(err)
}

func prefixed(alias, cols string) string {
	out := ""
	for i, c := range splitCols(cols) {
		if i > 0 {
			out += ", "
		}
		out += fmt.Sprintf("%s.%s", alias, c)
	}
	return out
}

func splitCols(cols string) []string {
	var out []string
	cur := ""
	for _, ch := range cols {
		switch ch {
		case ',':
			out = append(out, cur)
			cur = ""
		case ' ', '\n', '\t':
		default:
			cur += string(ch)
		}
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}

// ReopenCheckpoint puts a just-resolved checkpoint back to pending (used when the resume job
// could not be queued, so the researcher can answer again).
func (s *Store) ReopenCheckpoint(ctx context.Context, id int64) error {
	_, err := s.Pool.Exec(ctx, `UPDATE checkpoints SET status='pending', response='{}', resolved_at=NULL WHERE id=$1`, id)
	return err
}
