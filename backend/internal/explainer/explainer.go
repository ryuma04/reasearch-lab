// Package explainer serves the Paper-to-Video Explainer: queue a video for one of the workspace's papers, follow its
// progress, and stream the finished MP4. The agent worker (agents/lab/explainer) does the work and owns the files.
package explainer

import (
	"encoding/json"
	"errors"
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
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

// Premade ElevenLabs voices offered in the UI (same list as agents/lab/explainer/voice.py).
var voices = []map[string]string{
	{"id": "XrExE9yKIg1WjnnlVkGX", "name": "Matilda", "description": "Warm, professional"},
	{"id": "Xb7hH8MSUJpSbSDYk0k2", "name": "Alice", "description": "Clear British educator"},
	{"id": "onwK4e9ZLuTAKqWW03F9", "name": "Daniel", "description": "Steady British broadcaster"},
	{"id": "cjVigY5qzO86Huf0OWal", "name": "Eric", "description": "Smooth, trustworthy"},
	{"id": "SAz9YHcvj6GT2YYXdXww", "name": "River", "description": "Relaxed, neutral"},
}

var voiceRe = regexp.MustCompile(`^[A-Za-z0-9]{10,40}$`)
var assetRe = regexp.MustCompile(`^(figures|equations)/[A-Za-z0-9_-]+\.png$`)

type Service struct {
	cfg   *config.Config
	store *store.Store
	bus   *bus.Bus
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus) *Service { return &Service{cfg: cfg, store: st, bus: b} }

func (s *Service) Routes(r chi.Router) {
	h := httpx.Handler
	r.Get("/explainer/voices", h(s.Voices))
	r.Get("/workspaces/{id}/explainer", h(s.List))
	r.Post("/workspaces/{id}/explainer", h(s.Create))
	r.Get("/explainer/{videoId}", h(s.Get))
	r.Get("/explainer/{videoId}/video", h(s.Video))
	r.Get("/explainer/{videoId}/asset", h(s.Asset))
	r.Delete("/explainer/{videoId}", h(s.Delete))
}

type video struct {
	ID              int64           `json:"id"`
	WorkspaceID     int64           `json:"workspace_id"`
	UploadID        *int64          `json:"upload_id"`
	PaperTitle      string          `json:"paper_title"`
	Status          string          `json:"status"`
	Progress        float64         `json:"progress"`
	Message         string          `json:"message"`
	VoiceID         string          `json:"voice_id"`
	Script          json.RawMessage `json:"script,omitempty"`
	Report          json.RawMessage `json:"report,omitempty"`
	HasVideo        bool            `json:"has_video"`
	DurationSeconds float64         `json:"duration_seconds"`
	Error           string          `json:"error"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	videoPath       string
}

const cols = `id, workspace_id, upload_id, paper_title, status, progress, message, voice_id, script, report, video_path, duration_seconds, error, created_at, updated_at`

func scan(row pgx.Row) (*video, error) {
	var v video
	var script, report []byte
	if err := row.Scan(&v.ID, &v.WorkspaceID, &v.UploadID, &v.PaperTitle, &v.Status, &v.Progress, &v.Message, &v.VoiceID,
		&script, &report, &v.videoPath, &v.DurationSeconds, &v.Error, &v.CreatedAt, &v.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, store.ErrNotFound
		}
		return nil, err
	}
	v.Script, v.Report = script, report
	v.HasVideo = v.Status == "ready" && v.videoPath != ""
	return &v, nil
}

// load returns the video after checking the user's role in its workspace (non-members get 404).
func (s *Service) load(r *http.Request, minRole string) (*video, error) {
	id, err := httpx.IDParam(r, "videoId")
	if err != nil {
		return nil, err
	}
	v, err := scan(s.store.Pool.QueryRow(r.Context(), `SELECT `+cols+` FROM explainer_videos WHERE id=$1`, id))
	if err != nil {
		return nil, err
	}
	if _, err := workspace.Access(r.Context(), s.store, v.WorkspaceID, minRole); err != nil {
		return nil, err
	}
	return v, nil
}

// GET /explainer/voices
func (s *Service) Voices(w http.ResponseWriter, r *http.Request) error {
	httpx.JSON(w, http.StatusOK, map[string]any{"voices": voices, "default": voices[0]["id"], "configured": s.cfg.ElevenLabsConfigured()})
	return nil
}

// GET /workspaces/{id}/explainer: the workspace's videos, newest first (without the full script).
func (s *Service) List(w http.ResponseWriter, r *http.Request) error {
	wsID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, wsID, "viewer"); err != nil {
		return err
	}
	rows, err := s.store.Pool.Query(r.Context(), `SELECT `+cols+` FROM explainer_videos WHERE workspace_id=$1 ORDER BY id DESC LIMIT 50`, wsID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []*video{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return err
		}
		v.Script = nil
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"videos": out})
	return nil
}

// POST /workspaces/{id}/explainer {upload_id, voice_id?, fresh_script?}
// One video in progress per paper: a repeated click while one is queued or running returns that one.
func (s *Service) Create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	wsID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := workspace.Access(ctx, s.store, wsID, "editor"); err != nil {
		return err
	}
	var body struct {
		UploadID    int64  `json:"upload_id"`
		VoiceID     string `json:"voice_id"`
		FreshScript bool   `json:"fresh_script"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.VoiceID != "" && !voiceRe.MatchString(body.VoiceID) {
		return httpx.Errorf(http.StatusBadRequest, "invalid voice_id")
	}
	if !s.cfg.ElevenLabsConfigured() {
		return httpx.Errorf(http.StatusServiceUnavailable, "ElevenLabs is not configured on the server: set ELEVENLABS_API_KEYS in .env")
	}
	up, err := s.store.UploadByID(ctx, wsID, body.UploadID)
	if err != nil {
		return err
	}
	if up.Kind != "paper" {
		return httpx.Errorf(http.StatusBadRequest, "choose a paper (PDF or arXiv link)")
	}
	var existing int64
	err = s.store.Pool.QueryRow(ctx, `SELECT id FROM explainer_videos WHERE workspace_id=$1 AND upload_id=$2
		AND status NOT IN ('ready','failed') ORDER BY id DESC LIMIT 1`, wsID, up.ID).Scan(&existing)
	if err == nil {
		httpx.JSON(w, http.StatusAccepted, map[string]any{"id": existing, "queued": false})
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	title := up.OriginalName
	if title == "" {
		title = up.PathOrURL
	}
	var id int64
	if err := s.store.Pool.QueryRow(ctx, `INSERT INTO explainer_videos (workspace_id, upload_id, paper_title, voice_id, fresh_script, requested_by, message)
		VALUES ($1,$2,$3,$4,$5,$6,'Waiting for the agent worker') RETURNING id`,
		wsID, up.ID, strings.TrimSuffix(title, ".pdf"), body.VoiceID, body.FreshScript, auth.UserID(ctx)).Scan(&id); err != nil {
		return err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "explainer_video", "video_id": id, "user_id": auth.UserID(ctx)}); err != nil {
		_, _ = s.store.Pool.Exec(ctx, `UPDATE explainer_videos SET status='failed', error='could not reach the agent worker' WHERE id=$1`, id)
		return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"id": id, "queued": true})
	return nil
}

// GET /explainer/{videoId}: status, progress, script and fact-check report.
func (s *Service) Get(w http.ResponseWriter, r *http.Request) error {
	v, err := s.load(r, "viewer")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, v)
	return nil
}

// GET /explainer/{videoId}/video: the MP4 (supports Range requests for seeking). ?download=1 saves it.
func (s *Service) Video(w http.ResponseWriter, r *http.Request) error {
	v, err := s.load(r, "viewer")
	if err != nil {
		return err
	}
	if !v.HasVideo {
		return httpx.Errorf(http.StatusConflict, "the video is not ready yet")
	}
	p, err := workspace.DataPath(s.cfg.DataDir, v.videoPath)
	if err != nil {
		return httpx.ErrForbidden
	}
	name := "paper-explainer-" + strconv.FormatInt(v.ID, 10) + ".mp4"
	disp := "inline"
	if r.URL.Query().Get("download") == "1" {
		disp = "attachment"
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Disposition", disp+`; filename="`+name+`"`)
	http.ServeFile(w, r, p)
	return nil
}

// GET /explainer/{videoId}/asset?path=figures/F1.png: figure and equation crops shown next to the script.
func (s *Service) Asset(w http.ResponseWriter, r *http.Request) error {
	v, err := s.load(r, "viewer")
	if err != nil {
		return err
	}
	rel := r.URL.Query().Get("path")
	if !assetRe.MatchString(rel) {
		return httpx.Errorf(http.StatusBadRequest, "invalid asset path")
	}
	p := filepath.Join(s.cfg.DataDir, "workspaces", strconv.FormatInt(v.WorkspaceID, 10), "explainer", strconv.FormatInt(v.ID, 10), "public", filepath.FromSlash(rel))
	if _, err := os.Stat(p); err != nil {
		return store.ErrNotFound
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, p)
	return nil
}

// DELETE /explainer/{videoId}: editor only; refuses while the video is being made.
func (s *Service) Delete(w http.ResponseWriter, r *http.Request) error {
	v, err := s.load(r, "editor")
	if err != nil {
		return err
	}
	if v.Status != "ready" && v.Status != "failed" {
		return httpx.Errorf(http.StatusConflict, "this video is still being made")
	}
	if _, err := s.store.Pool.Exec(r.Context(), `DELETE FROM explainer_videos WHERE id=$1`, v.ID); err != nil {
		return err
	}
	_ = os.RemoveAll(filepath.Join(s.cfg.DataDir, "workspaces", strconv.FormatInt(v.WorkspaceID, 10), "explainer", strconv.FormatInt(v.ID, 10)))
	w.WriteHeader(http.StatusNoContent)
	return nil
}
