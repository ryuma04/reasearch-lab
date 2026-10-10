package runs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

const maxChangeChars = 4000

// requestHash identifies a change request for idempotency: the same words (ignoring case and spacing) on the same
// source version are the same request.
func requestHash(text string) string {
	norm := strings.ToLower(strings.Join(strings.Fields(text), " "))
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:16])
}

// validateChangeText rejects empty, trivially short and oversized requests with a message the researcher can act on.
func validateChangeText(text string) (string, error) {
	t := strings.TrimSpace(text)
	switch {
	case t == "":
		return "", httpx.Errorf(http.StatusBadRequest, "Describe what you want to change.")
	case len(strings.Fields(t)) < 3:
		return "", httpx.Errorf(http.StatusBadRequest, "Please describe the change in a few words, for example what should be different and why.")
	case utf8.RuneCountInString(t) > maxChangeChars:
		return "", httpx.Errorf(http.StatusBadRequest, "The request is too long (limit "+strconv.Itoa(maxChangeChars)+" characters).")
	}
	return t, nil
}

// POST /runs/{id}/changes {request}: the source run must be finished. Creates a change request and a new version
// (a new run linked to the source, with its own copy of the code); the source version is never touched.
func (s *Service) RequestChange(w http.ResponseWriter, r *http.Request) error {
	src, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Request string `json:"request"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	text, err := validateChangeText(body.Request)
	if err != nil {
		return err
	}
	if src.Kind != "main" || (src.Status != "completed" && src.Status != "failed") {
		return httpx.Errorf(http.StatusConflict, "Changes can be requested once a version has finished (this one is "+src.Status+").")
	}
	cr, created, err := s.store.CreateChangeRequest(r.Context(), src, text, requestHash(text), auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		if err := s.bus.Enqueue(r.Context(), map[string]any{"type": "start_run", "run_id": *cr.NewRunID, "user_id": auth.UserID(r.Context())}); err != nil {
			_ = s.store.SetRunStatus(r.Context(), *cr.NewRunID, "failed", "", "could not queue the new version: "+err.Error())
			return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
		}
		s.event(r.Context(), *cr.NewRunID, "system", "run_queued", "New version queued from run #"+strconv.FormatInt(src.ID, 10),
			"Your change request creates a new version; the original stays untouched", map[string]any{"source_run_id": src.ID, "change_request_id": cr.ID})
	}
	httpx.JSON(w, status, map[string]any{"change": cr, "new_run_id": cr.NewRunID, "created": created})
	return nil
}

// GET /runs/{id}/change: the change request that created this run (null for an original run).
func (s *Service) ChangeOfRun(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	cr, err := s.store.ChangeForRun(r.Context(), run.ID)
	if errors.Is(err, store.ErrNotFound) {
		httpx.JSON(w, http.StatusOK, map[string]any{"change": nil})
		return nil
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"change": cr})
	return nil
}

// GET /runs/{id}/versions: every version of the run's workspace, oldest first.
func (s *Service) Versions(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	v, err := s.store.Versions(r.Context(), run.WorkspaceID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"versions": v, "current": run.ID})
	return nil
}

type planTask struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type planFile struct {
	Ready string `json:"ready"`
	Init  struct {
		Plan struct {
			Tasks []planTask `json:"tasks"`
		} `json:"plan"`
	} `json:"initial"`
	Opt *struct {
		Plan *struct {
			Tasks []planTask `json:"tasks"`
		} `json:"plan"`
	} `json:"optimized"`
}

// planTitles returns the task titles of the plan a version was approved from (the optimized one when it passed validation).
func (s *Service) planTitles(projectDir string) []string {
	raw, err := os.ReadFile(filepath.Join(projectDir, "research", "plan_review.json"))
	if err != nil {
		return nil
	}
	var p planFile
	if json.Unmarshal(raw, &p) != nil {
		return nil
	}
	tasks := p.Init.Plan.Tasks
	if p.Ready == "optimized" && p.Opt != nil && p.Opt.Plan != nil {
		tasks = p.Opt.Plan.Tasks
	}
	out := make([]string, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.Title)
	}
	return out
}

func setDiff(a, b []string) (added, removed []string) {
	in := func(l []string, v string) bool {
		for _, x := range l {
			if x == v {
				return true
			}
		}
		return false
	}
	for _, v := range b {
		if !in(a, v) {
			added = append(added, v)
		}
	}
	for _, v := range a {
		if !in(b, v) {
			removed = append(removed, v)
		}
	}
	return
}

type metricRow struct {
	Name string   `json:"name"`
	Old  *float64 `json:"old"`
	New  *float64 `json:"new"`
}

// metricRows pairs the recorded metrics of two versions by name (sorted by name via the map order of the caller).
func metricRows(om, nm map[string]float64) []metricRow {
	names := map[string]bool{}
	for n := range om {
		names[n] = true
	}
	for n := range nm {
		names[n] = true
	}
	keys := make([]string, 0, len(names))
	for n := range names {
		keys = append(keys, n)
	}
	sortStrings(keys)
	out := make([]metricRow, 0, len(keys))
	for _, n := range keys {
		row := metricRow{Name: n}
		if v, ok := om[n]; ok {
			v := v
			row.Old = &v
		}
		if v, ok := nm[n]; ok {
			v := v
			row.New = &v
		}
		out = append(out, row)
	}
	return out
}

// GET /runs/{id}/compare?with={otherRunId}: "old" is the run in the path, "new" is `with`. Both must be versions of
// the same workspace. Code differences come from the two versions own files; metrics from recorded results.
func (s *Service) Compare(w http.ResponseWriter, r *http.Request) error {
	oldRun, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	otherID, err := strconv.ParseInt(r.URL.Query().Get("with"), 10, 64)
	if err != nil || otherID <= 0 {
		return httpx.Errorf(http.StatusBadRequest, "with must be the id of the version to compare against")
	}
	newRun, err := s.store.RunByID(r.Context(), otherID)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, newRun.WorkspaceID, "viewer"); err != nil {
		return err
	}
	if newRun.WorkspaceID != oldRun.WorkspaceID {
		return store.ErrNotFound
	}
	files, skipped := diffTrees(s.projectDir(oldRun), s.projectDir(newRun))
	om, err := s.store.LatestMetrics(r.Context(), oldRun.ID)
	if err != nil {
		return err
	}
	nm, err := s.store.LatestMetrics(r.Context(), newRun.ID)
	if err != nil {
		return err
	}
	oc, _ := s.store.ScoreCounts(r.Context(), oldRun.ID)
	nc, _ := s.store.ScoreCounts(r.Context(), newRun.ID)
	added, removed := setDiff(s.planTitles(s.projectDir(oldRun)), s.planTitles(s.projectDir(newRun)))
	ch, _ := s.store.ChangeForRun(r.Context(), newRun.ID)
	httpx.JSON(w, http.StatusOK, map[string]any{
		"old":    map[string]any{"run_id": oldRun.ID, "status": oldRun.Status, "stage": oldRun.Stage, "error": oldRun.Error},
		"new":    map[string]any{"run_id": newRun.ID, "status": newRun.Status, "stage": newRun.Stage, "error": newRun.Error},
		"change": ch, "files": files, "skipped": skipped, "metrics": metricRows(om, nm),
		"scorecard": map[string]any{"old": oc, "new": nc}, "plan": map[string]any{"added": added, "removed": removed},
		"note": "Differences are computed from each version's own files and recorded results; a newer version is not assumed to be better.",
	})
	return nil
}
