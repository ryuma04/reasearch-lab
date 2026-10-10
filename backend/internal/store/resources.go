package store

import (
	"context"
	"time"
)

// ResourceDecision is the researcher's decision on one recommended resource of a run.
type ResourceDecision struct {
	RecID     string    `json:"rec_id"`
	Decision  string    `json:"decision"`
	Note      string    `json:"note"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SetResourceDecision records (or changes) the decision; there is one per run and recommendation.
func (s *Store) SetResourceDecision(ctx context.Context, runID int64, recID, decision, note string, userID int64) (*ResourceDecision, error) {
	d := &ResourceDecision{}
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO resource_decisions (run_id, rec_id, decision, note, user_id) VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (run_id, rec_id) DO UPDATE SET decision=EXCLUDED.decision, note=EXCLUDED.note, user_id=EXCLUDED.user_id, updated_at=now()
		RETURNING rec_id, decision, note, updated_at`, runID, recID, decision, note, userID).Scan(&d.RecID, &d.Decision, &d.Note, &d.UpdatedAt)
	return d, err
}

// ClearResourceDecision removes the decision, returning the recommendation to "undecided".
func (s *Store) ClearResourceDecision(ctx context.Context, runID int64, recID string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM resource_decisions WHERE run_id=$1 AND rec_id=$2`, runID, recID)
	return err
}

// ResourceDecisions returns the run's decisions keyed by recommendation id.
func (s *Store) ResourceDecisions(ctx context.Context, runID int64) (map[string]ResourceDecision, error) {
	rows, err := s.Pool.Query(ctx, `SELECT rec_id, decision, note, updated_at FROM resource_decisions WHERE run_id=$1`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]ResourceDecision{}
	for rows.Next() {
		var d ResourceDecision
		if err := rows.Scan(&d.RecID, &d.Decision, &d.Note, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out[d.RecID] = d
	}
	return out, rows.Err()
}
