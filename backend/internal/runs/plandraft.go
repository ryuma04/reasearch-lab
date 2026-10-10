package runs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
)

// ValidateSettingChanges checks exact setting edits: scalar values only, bounded size.
func ValidateSettingChanges(changes map[string]any) error {
	if len(changes) > 50 {
		return httpx.Errorf(http.StatusBadRequest, "too many setting changes")
	}
	for k, v := range changes {
		switch t := v.(type) {
		case float64, bool:
		case string:
			if len(t) > 200 {
				return httpx.Errorf(http.StatusBadRequest, "value of "+k+" is too long")
			}
		default:
			return httpx.Errorf(http.StatusBadRequest, "setting "+k+" must be a string, number or boolean")
		}
	}
	return nil
}

type planDraft struct {
	Changes map[string]any `json:"changes"`
	Note    string         `json:"note"`
}

// PUT /runs/{id}/plan/draft {"changes": {"train.epochs_student": 12}, "note": "..."}
// Saves the researcher's unapproved edits to the pending plan so they survive a refresh or a different
// browser. Nothing is applied to the run until the plan is approved (POST /checkpoints/plan).
func (s *Service) SavePlanDraft(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body planDraft
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if err := ValidateSettingChanges(body.Changes); err != nil {
		return err
	}
	if len(body.Note) > 1000 {
		return httpx.Errorf(http.StatusBadRequest, "the note is too long (max 1000 characters)")
	}
	ctx := r.Context()
	known, err := s.settingNames(ctx, run.ID)
	if err != nil {
		return err
	}
	for k := range body.Changes {
		if !known[k] {
			return httpx.Errorf(http.StatusBadRequest, "unknown setting: "+k)
		}
	}
	draft := map[string]any{"changes": body.Changes, "note": strings.TrimSpace(body.Note),
		"saved_at": time.Now().UTC().Format(time.RFC3339), "saved_by": auth.UserID(ctx)}
	raw, _ := json.Marshal(draft)
	tag, err := s.store.Pool.Exec(ctx, `UPDATE checkpoints SET payload = payload || jsonb_build_object('draft', $2::jsonb)
		WHERE run_id=$1 AND name='plan' AND status='pending'`, run.ID, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.Errorf(http.StatusConflict, "the plan is not waiting for approval, so it can no longer be edited")
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"draft": draft})
	return nil
}

// DELETE /runs/{id}/plan/draft — discards the saved draft.
func (s *Service) DiscardPlanDraft(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	if _, err := s.store.Pool.Exec(r.Context(), `UPDATE checkpoints SET payload = payload - 'draft'
		WHERE run_id=$1 AND name='plan' AND status='pending'`, run.ID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) settingNames(ctx context.Context, runID int64) (map[string]bool, error) {
	rows, err := s.store.Pool.Query(ctx, `SELECT name FROM settings WHERE run_id=$1`, runID)
	if err != nil {
		return nil, fmt.Errorf("settings: %w", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out[n] = true
	}
	return out, rows.Err()
}
