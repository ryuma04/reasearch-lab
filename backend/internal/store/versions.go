package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ChangeRequest is a researcher's natural-language request that created (or will create) a new version.
type ChangeRequest struct {
	ID          int64           `json:"id"`
	WorkspaceID int64           `json:"workspace_id"`
	SourceRunID int64           `json:"source_run_id"`
	NewRunID    *int64          `json:"new_run_id"`
	Request     string          `json:"request"`
	Status      string          `json:"status"`
	Analysis    json.RawMessage `json:"analysis"`
	CreatedAt   time.Time       `json:"created_at"`
}

const crCols = `id, workspace_id, source_run_id, new_run_id, request_text, status, analysis, created_at`

func scanCR(row pgx.Row) (*ChangeRequest, error) {
	c := &ChangeRequest{}
	return c, notFound(row.Scan(&c.ID, &c.WorkspaceID, &c.SourceRunID, &c.NewRunID, &c.Request, &c.Status, &c.Analysis, &c.CreatedAt))
}

// CreateChangeRequest records the request and creates the new version (a main run whose parent is the source run)
// in one transaction. The same text for the same source version returns the existing one (created == false), so a
// double click or a retry after a timeout never makes a second version.
func (s *Store) CreateChangeRequest(ctx context.Context, src *Run, text, hash string, userID int64) (cr *ChangeRequest, created bool, err error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	if _, err = tx.Exec(ctx, `SELECT 1 FROM runs WHERE id=$1 FOR UPDATE`, src.ID); err != nil {
		return nil, false, err
	}
	existing, err := scanCR(tx.QueryRow(ctx, `SELECT `+crCols+` FROM change_requests WHERE source_run_id=$1 AND request_hash=$2`, src.ID, hash))
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	var n int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM runs WHERE workspace_id=$1 AND kind='main'`, src.WorkspaceID).Scan(&n); err != nil {
		return nil, false, err
	}
	var newID int64
	if err = tx.QueryRow(ctx, `INSERT INTO runs (workspace_id, parent_run_id, kind, branch_name, compute_budget)
		VALUES ($1,$2,'main',$3,$4) RETURNING id`, src.WorkspaceID, src.ID, fmt.Sprintf("v%d", n+1), src.ComputeBudget).Scan(&newID); err != nil {
		return nil, false, err
	}
	cr, err = scanCR(tx.QueryRow(ctx, `INSERT INTO change_requests (workspace_id, source_run_id, new_run_id, request_text, request_hash, user_id)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+crCols, src.WorkspaceID, src.ID, newID, text, hash, userID))
	if err != nil {
		return nil, false, err
	}
	return cr, true, tx.Commit(ctx)
}

// ChangeForRun returns the change request that created this run, or ErrNotFound for an original run.
func (s *Store) ChangeForRun(ctx context.Context, runID int64) (*ChangeRequest, error) {
	return scanCR(s.Pool.QueryRow(ctx, `SELECT `+crCols+` FROM change_requests WHERE new_run_id=$1`, runID))
}

// Version is one main run of a workspace with the change request that produced it.
type Version struct {
	RunID       int64      `json:"run_id"`
	Label       string     `json:"label"`
	ParentRunID *int64     `json:"parent_run_id"`
	Status      string     `json:"status"`
	Stage       string     `json:"stage"`
	Error       string     `json:"error"`
	CreatedAt   time.Time  `json:"created_at"`
	FinishedAt  *time.Time `json:"finished_at"`
	Change      *string    `json:"change"`
	ChangeState *string    `json:"change_status"`
}

// Versions lists the workspace's main runs oldest first; the first is "Original", the rest are "Version N".
func (s *Store) Versions(ctx context.Context, wsID int64) ([]Version, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT r.id, r.parent_run_id, r.status, r.stage, r.error, r.created_at, r.finished_at, c.request_text, c.status
		FROM runs r LEFT JOIN change_requests c ON c.new_run_id = r.id
		WHERE r.workspace_id=$1 AND r.kind='main' ORDER BY r.id`, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		v := Version{}
		if err := rows.Scan(&v.RunID, &v.ParentRunID, &v.Status, &v.Stage, &v.Error, &v.CreatedAt, &v.FinishedAt, &v.Change, &v.ChangeState); err != nil {
			return nil, err
		}
		v.Label = "Original"
		if len(out) > 0 {
			v.Label = fmt.Sprintf("Version %d", len(out)+1)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// PaperMaterial is the generation state of a run's research-paper materials.
type PaperMaterial struct {
	RunID     int64           `json:"run_id"`
	Status    string          `json:"status"`
	Manifest  json.RawMessage `json:"manifest"`
	Error     string          `json:"error"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (s *Store) PaperMaterial(ctx context.Context, runID int64) (*PaperMaterial, error) {
	p := &PaperMaterial{}
	return p, notFound(s.Pool.QueryRow(ctx, `SELECT run_id, status, manifest, error, updated_at FROM paper_materials WHERE run_id=$1`, runID).
		Scan(&p.RunID, &p.Status, &p.Manifest, &p.Error, &p.UpdatedAt))
}

// RequestPaperMaterials queues generation unless one is already queued or running (one job per run, however many clicks).
func (s *Store) RequestPaperMaterials(ctx context.Context, runID, userID int64) (queued bool, err error) {
	tag, err := s.Pool.Exec(ctx, `
		INSERT INTO paper_materials (run_id, status, requested_by) VALUES ($1,'queued',$2)
		ON CONFLICT (run_id) DO UPDATE SET status='queued', error='', requested_by=EXCLUDED.requested_by, updated_at=now()
		WHERE paper_materials.status NOT IN ('queued','generating')`, runID, userID)
	return tag.RowsAffected() == 1, err
}

// LatestMetrics returns the newest value of each metric of a run (numbers written by code that actually ran).
func (s *Store) LatestMetrics(ctx context.Context, runID int64) (map[string]float64, error) {
	rows, err := s.Pool.Query(ctx, `SELECT DISTINCT ON (name) name, value FROM metrics WHERE run_id=$1 ORDER BY name, id DESC`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var n string
		var v float64
		if err := rows.Scan(&n, &v); err != nil {
			return nil, err
		}
		out[n] = v
	}
	return out, rows.Err()
}

// ScoreCounts returns how many claims of a run are match / close / different / missing.
func (s *Store) ScoreCounts(ctx context.Context, runID int64) (map[string]int, error) {
	rows, err := s.Pool.Query(ctx, `SELECT status, count(*) FROM scorecard_entries WHERE run_id=$1 GROUP BY status`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}
