package runs

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

func sortStrings(s []string) { sort.Strings(s) }

// paperSections is the fixed set of documents the paper-materials job writes under research/paper/.
var paperSections = []struct{ Key, Title string }{
	{"overview", "Research overview"}, {"architecture", "System architecture"}, {"workflow", "Complete workflow"},
	{"dataflow", "Data flow"}, {"algorithms", "Algorithms and models"}, {"results", "Experimental setup and results"},
	{"references", "References and evidence"}, {"outline", "Writing outline"},
}

// GET /runs/{id}/paper: the generation state of this version's research-paper materials and, once written, the documents.
func (s *Service) Paper(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	pm, err := s.store.PaperMaterial(r.Context(), run.ID)
	if errors.Is(err, store.ErrNotFound) {
		httpx.JSON(w, http.StatusOK, map[string]any{"status": "none", "run_id": run.ID, "sections": []any{}})
		return nil
	}
	if err != nil {
		return err
	}
	out := map[string]any{"status": pm.Status, "run_id": run.ID, "error": pm.Error, "updated_at": pm.UpdatedAt}
	var manifest map[string]any
	_ = json.Unmarshal(pm.Manifest, &manifest)
	out["manifest"] = manifest
	sections := []map[string]any{}
	if pm.Status == "ready" || pm.Status == "partial" {
		dir := filepath.Join(s.projectDir(run), "research", "paper")
		for _, sec := range paperSections {
			if raw, err := os.ReadFile(filepath.Join(dir, sec.Key+".md")); err == nil {
				sections = append(sections, map[string]any{"key": sec.Key, "title": sec.Title, "markdown": string(raw)})
			}
		}
		// Materials describe the version as it was when they were generated; flag them when the run changed afterwards.
		if g, ok := manifest["generated_at"].(string); ok && run.FinishedAt != nil {
			if t, err := time.Parse(time.RFC3339, g); err == nil && run.FinishedAt.After(t) {
				out["stale"] = true
			}
		}
	}
	out["sections"] = sections
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// POST /runs/{id}/paper: queue generation for this version. Repeated clicks while one is queued or running do nothing.
func (s *Service) GeneratePaper(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	if run.Kind != "main" || (run.Status != "completed" && run.Status != "failed") {
		return httpx.Errorf(http.StatusConflict, "Research-paper materials need a finished version (this one is "+run.Status+").")
	}
	queued, err := s.store.RequestPaperMaterials(r.Context(), run.ID, auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	if queued {
		if err := s.bus.Enqueue(r.Context(), map[string]any{"type": "paper", "run_id": run.ID, "user_id": auth.UserID(r.Context())}); err != nil {
			return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
		}
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"queued": queued, "run_id": run.ID})
	return nil
}
