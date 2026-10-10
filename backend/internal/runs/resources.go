package runs

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

var validDecisions = map[string]bool{"accept": true, "reject": true, "keep_original": true, "supplement": true}

// briefResources reads the better-resource review the research agents saved with the brief.
// ok is false for runs that finished before the review existed.
func (s *Service) briefResources(projectDir string) (res map[string]any, originals map[string]any, ok bool) {
	raw, err := os.ReadFile(filepath.Join(projectDir, "research", "brief.json"))
	if err != nil {
		return nil, nil, false
	}
	var b struct {
		Sources struct {
			Resources    map[string]any   `json:"resources"`
			Datasets     []map[string]any `json:"datasets"`
			Repositories []map[string]any `json:"repositories"`
		} `json:"sources"`
	}
	if json.Unmarshal(raw, &b) != nil {
		return nil, nil, false
	}
	pick := func(in []map[string]any) []map[string]any {
		out := []map[string]any{}
		for _, m := range in {
			if u, _ := m["user_provided"].(bool); u {
				out = append(out, m)
			}
		}
		return out
	}
	originals = map[string]any{"datasets": pick(b.Sources.Datasets), "repositories": pick(b.Sources.Repositories)}
	return b.Sources.Resources, originals, b.Sources.Resources != nil
}

// GET /runs/{id}/resources: discovery status, the recommendation records with the researcher's decisions, and the originals.
func (s *Service) Resources(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	res, originals, ok := s.briefResources(s.projectDir(run))
	if !ok {
		httpx.JSON(w, http.StatusOK, map[string]any{"discovery": map[string]any{"status": "not_run", "note": "This run was created before the better-resource review existed.", "providers": []any{}},
			"recommendations": []any{}, "originals": map[string]any{"datasets": []any{}, "repositories": []any{}}})
		return nil
	}
	decisions, err := s.store.ResourceDecisions(r.Context(), run.ID)
	if err != nil {
		return err
	}
	recs, _ := res["recommendations"].([]any)
	for _, it := range recs {
		if m, ok := it.(map[string]any); ok {
			id, _ := m["id"].(string)
			if d, found := decisions[id]; found {
				m["decision"] = d
			} else {
				m["decision"] = nil
			}
		}
	}
	if recs == nil {
		recs = []any{}
	}
	disc := map[string]any{}
	for k, v := range res {
		if k != "recommendations" {
			disc[k] = v
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"discovery": disc, "recommendations": recs, "originals": originals})
	return nil
}

// PUT /runs/{id}/resources/{recId} {decision, note}. The recommendation must exist in this run's own review
// (the client cannot invent one or touch another run's), and only an owner or editor may decide.
func (s *Service) SetResourceDecision(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !validDecisions[body.Decision] {
		return httpx.Errorf(http.StatusBadRequest, "decision must be accept, reject, keep_original or supplement")
	}
	recID := chiParam(r, "recId")
	name, found := s.recName(run, recID)
	if !found {
		return store.ErrNotFound
	}
	d, err := s.store.SetResourceDecision(r.Context(), run.ID, recID, body.Decision, strings.TrimSpace(body.Note), auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	s.event(r.Context(), run.ID, "researcher", "resource_decision", "Researcher chose \""+body.Decision+"\" for "+name,
		"Your decision is passed to the implementation planner", map[string]any{"rec_id": recID, "decision": body.Decision})
	httpx.JSON(w, http.StatusOK, d)
	return nil
}

// DELETE /runs/{id}/resources/{recId}: take the decision back.
func (s *Service) ClearResourceDecision(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	if err := s.store.ClearResourceDecision(r.Context(), run.ID, chiParam(r, "recId")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// recName returns the display name of a recommendation of this run, or false if the run's review has no such id.
func (s *Service) recName(run *store.Run, recID string) (string, bool) {
	res, _, ok := s.briefResources(s.projectDir(run))
	if !ok {
		return "", false
	}
	recs, _ := res["recommendations"].([]any)
	for _, it := range recs {
		if m, ok := it.(map[string]any); ok && m["id"] == recID {
			name, _ := m["name"].(string)
			return name, true
		}
	}
	return "", false
}
