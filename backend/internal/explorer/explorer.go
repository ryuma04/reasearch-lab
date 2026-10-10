// Package explorer serves the Research Gap Explorer: it starts the analysis job (run by the agent worker), returns the
// stored analysis, and keeps the researcher's feedback. It only READS the research workflow's output and has its own
// tables (explorer_analyses, explorer_feedback), so it cannot affect runs, approvals or the pipeline.
package explorer

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

type Service struct {
	cfg   *config.Config
	store *store.Store
	bus   *bus.Bus
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus) *Service {
	return &Service{cfg: cfg, store: st, bus: b}
}

var (
	itemIDRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)
	itemTypes = map[string]bool{"recommendation": true, "gap": true, "idea": true}
	decisions = map[string]bool{"accepted": true, "rejected": true, "edited": true, "investigate": true, "added": true}
)

// loadRun checks the caller's role in the run's workspace. Non-members get 404.
func (s *Service) loadRun(r *http.Request, minRole string) (*store.Run, error) {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return nil, err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, minRole); err != nil {
		return nil, err
	}
	return run, nil
}

// analysed reports whether the Research Agent has finished analysing this run's paper (research/brief.json exists).
func (s *Service) analysed(run *store.Run) bool {
	p := filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(run.WorkspaceID, run.ID)), "research", "brief.json")
	_, err := os.Stat(p)
	return err == nil
}

type analysisRow struct {
	ID         int64           `json:"id"`
	Status     string          `json:"status"`
	Stage      string          `json:"stage"`
	Error      string          `json:"error"`
	Data       json.RawMessage `json:"data"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	FinishedAt *time.Time      `json:"finished_at,omitempty"`
}

type feedbackRow struct {
	ID        int64           `json:"id"`
	ItemType  string          `json:"item_type"`
	ItemID    string          `json:"item_id"`
	Decision  string          `json:"decision"`
	Reason    string          `json:"reason"`
	Edited    json.RawMessage `json:"edited"`
	UserID    *int64          `json:"user_id"`
	Mine      bool            `json:"mine"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func (s *Service) analysis(ctx context.Context, runID int64) (*analysisRow, error) {
	a := &analysisRow{}
	err := s.store.Pool.QueryRow(ctx, `SELECT id, status, stage, error, data, created_at, updated_at, finished_at FROM explorer_analyses WHERE run_id=$1`, runID).
		Scan(&a.ID, &a.Status, &a.Stage, &a.Error, &a.Data, &a.CreatedAt, &a.UpdatedAt, &a.FinishedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return a, err
}

func (s *Service) feedback(ctx context.Context, analysisID, uid int64) ([]feedbackRow, error) {
	rows, err := s.store.Pool.Query(ctx, `SELECT id, item_type, item_id, decision, reason, edited, user_id, updated_at FROM explorer_feedback
		WHERE analysis_id=$1 ORDER BY updated_at`, analysisID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []feedbackRow{}
	for rows.Next() {
		var f feedbackRow
		if err := rows.Scan(&f.ID, &f.ItemType, &f.ItemID, &f.Decision, &f.Reason, &f.Edited, &f.UserID, &f.UpdatedAt); err != nil {
			return nil, err
		}
		f.Mine = f.UserID != nil && *f.UserID == uid
		out = append(out, f)
	}
	return out, rows.Err()
}

// GET /runs/{id}/explorer
func (s *Service) Get(w http.ResponseWriter, r *http.Request) error {
	run, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	ctx := r.Context()
	a, err := s.analysis(ctx, run.ID)
	if err != nil {
		return err
	}
	fb := []feedbackRow{}
	if a != nil {
		if fb, err = s.feedback(ctx, a.ID, auth.UserID(ctx)); err != nil {
			return err
		}
	}
	ws, _ := workspace.Access(ctx, s.store, run.WorkspaceID, "viewer")
	canEdit := ws != nil && (ws.Role == "owner" || ws.Role == "editor")
	httpx.JSON(w, http.StatusOK, map[string]any{"analysis": a, "feedback": fb, "ready": s.analysed(run), "can_edit": canEdit, "run_id": run.ID, "workspace_id": run.WorkspaceID})
	return nil
}

// POST /runs/{id}/explorer — start (or refresh) the analysis. Idempotent while one is queued or running.
func (s *Service) Start(w http.ResponseWriter, r *http.Request) error {
	run, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	if !s.analysed(run) {
		return httpx.Errorf(http.StatusConflict, "this paper has not been analysed yet; wait for the research stage to finish first")
	}
	ctx := r.Context()
	var id int64
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO explorer_analyses (run_id, workspace_id, status, stage, created_by) VALUES ($1, $2, 'queued', 'Queued', $3)
		ON CONFLICT (run_id) DO UPDATE SET status='queued', stage='Queued', error='', updated_at=now(), created_by=$3
		WHERE explorer_analyses.status NOT IN ('queued', 'running') OR explorer_analyses.updated_at < now() - interval '15 minutes'
		RETURNING id`, run.ID, run.WorkspaceID, auth.UserID(ctx)).Scan(&id)
	if err == pgx.ErrNoRows { // already queued or running
		httpx.JSON(w, http.StatusOK, map[string]any{"started": false, "message": "An analysis is already in progress."})
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "explorer", "run_id": run.ID, "analysis_id": id}); err != nil {
		_, _ = s.store.Pool.Exec(context.WithoutCancel(ctx), `UPDATE explorer_analyses SET status='failed', stage='', error='could not queue the analysis', updated_at=now() WHERE id=$1`, id)
		return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"started": true, "analysis_id": id})
	return nil
}

type feedbackBody struct {
	ItemType string            `json:"item_type"`
	ItemID   string            `json:"item_id"`
	Decision string            `json:"decision"`
	Reason   string            `json:"reason"`
	Edited   map[string]string `json:"edited"`
}

func validEdited(m map[string]string) error {
	if len(m) > 8 {
		return httpx.Errorf(http.StatusBadRequest, "too many edited fields")
	}
	for k, v := range m {
		if len(k) > 40 || len(v) > 3000 {
			return httpx.Errorf(http.StatusBadRequest, "edited text is too long")
		}
	}
	return nil
}

// PUT /runs/{id}/explorer/feedback — accept, reject (with optional reason), edit, or request investigation.
func (s *Service) SaveFeedback(w http.ResponseWriter, r *http.Request) error {
	run, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var b feedbackBody
	if err := httpx.Decode(r, &b); err != nil {
		return err
	}
	if !itemTypes[b.ItemType] || b.ItemType == "idea" || !decisions[b.Decision] || b.Decision == "added" || !itemIDRe.MatchString(b.ItemID) {
		return httpx.Errorf(http.StatusBadRequest, "item_type must be recommendation or gap and decision accepted, rejected, edited or investigate")
	}
	if len(b.Reason) > 1000 {
		return httpx.Errorf(http.StatusBadRequest, "the reason is too long (max 1000 characters)")
	}
	if err := validEdited(b.Edited); err != nil {
		return err
	}
	if b.Decision == "edited" && strings.TrimSpace(b.Edited["improvement"]+b.Edited["text"]) == "" {
		return httpx.Errorf(http.StatusBadRequest, "an edit needs the refined text")
	}
	ctx := r.Context()
	a, err := s.analysis(ctx, run.ID)
	if err != nil {
		return err
	}
	if a == nil {
		return store.ErrNotFound
	}
	// The item must exist in this analysis: no feedback on made-up ids.
	key := map[string]string{"recommendation": "recommendations", "gap": "gaps"}[b.ItemType]
	var exists bool
	if err := s.store.Pool.QueryRow(ctx, `SELECT COALESCE(data->($2::text) @> jsonb_build_array(jsonb_build_object('id', $3::text)), false) FROM explorer_analyses WHERE id=$1`, a.ID, key, b.ItemID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return httpx.Errorf(http.StatusNotFound, "that item is not part of this analysis")
	}
	edited, _ := json.Marshal(b.Edited)
	var out feedbackRow
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO explorer_feedback (analysis_id, item_type, item_id, decision, reason, edited, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (analysis_id, item_type, item_id, COALESCE(user_id, 0)) DO UPDATE SET decision=$4, reason=$5, edited=$6, updated_at=now()
		RETURNING id, item_type, item_id, decision, reason, edited, user_id, updated_at`,
		a.ID, b.ItemType, b.ItemID, b.Decision, strings.TrimSpace(b.Reason), edited, auth.UserID(ctx)).
		Scan(&out.ID, &out.ItemType, &out.ItemID, &out.Decision, &out.Reason, &out.Edited, &out.UserID, &out.UpdatedAt)
	if err != nil {
		return err
	}
	out.Mine = true
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// POST /runs/{id}/explorer/ideas {"title": "...", "text": "..."} — the researcher's own research idea.
func (s *Service) AddIdea(w http.ResponseWriter, r *http.Request) error {
	run, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var b struct {
		Title string `json:"title"`
		Text  string `json:"text"`
	}
	if err := httpx.Decode(r, &b); err != nil {
		return err
	}
	b.Title, b.Text = strings.TrimSpace(b.Title), strings.TrimSpace(b.Text)
	if b.Text == "" || len(b.Text) > 3000 || len(b.Title) > 140 {
		return httpx.Errorf(http.StatusBadRequest, "describe your idea (up to 3000 characters; title up to 140)")
	}
	ctx := r.Context()
	a, err := s.analysis(ctx, run.ID)
	if err != nil {
		return err
	}
	if a == nil {
		return httpx.Errorf(http.StatusConflict, "run the analysis first, then add your own ideas to it")
	}
	edited, _ := json.Marshal(map[string]string{"title": b.Title, "text": b.Text})
	var out feedbackRow
	id := "idea-" + auth.RandomToken(6)
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO explorer_feedback (analysis_id, item_type, item_id, decision, edited, user_id) VALUES ($1,'idea',$2,'added',$3,$4)
		RETURNING id, item_type, item_id, decision, reason, edited, user_id, updated_at`, a.ID, id, edited, auth.UserID(ctx)).
		Scan(&out.ID, &out.ItemType, &out.ItemID, &out.Decision, &out.Reason, &out.Edited, &out.UserID, &out.UpdatedAt)
	if err != nil {
		return err
	}
	out.Mine = true
	httpx.JSON(w, http.StatusCreated, out)
	return nil
}

// DELETE /runs/{id}/explorer/feedback/{feedbackId} — clears the caller's own decision or removes their own idea.
func (s *Service) DeleteFeedback(w http.ResponseWriter, r *http.Request) error {
	run, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	fid, err := strconv.ParseInt(chi.URLParam(r, "feedbackId"), 10, 64)
	if err != nil || fid <= 0 {
		return httpx.Errorf(http.StatusBadRequest, "invalid feedback id")
	}
	tag, err := s.store.Pool.Exec(r.Context(), `DELETE FROM explorer_feedback f USING explorer_analyses a
		WHERE f.id=$1 AND f.analysis_id=a.id AND a.run_id=$2 AND f.user_id=$3`, fid, run.ID, auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return store.ErrNotFound
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
