package runs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/skip2/go-qrcode"

	"github.com/ryuma04/tapu-sena/services/api/internal/auth"
	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
	"github.com/ryuma04/tapu-sena/services/api/internal/workspace"
)

func chiParam(r *http.Request, name string) string { return chi.URLParam(r, name) }

// POST /workspaces/{id}/share {"hours": 72} — read-only live link + QR code (PNG, base64).
func (s *Service) CreateShare(w http.ResponseWriter, r *http.Request) error {
	wsID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, wsID, "owner"); err != nil {
		return err
	}
	var body struct {
		Hours int `json:"hours"`
	}
	if r.ContentLength > 0 {
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
	}
	if body.Hours <= 0 || body.Hours > 24*30 {
		body.Hours = 72
	}
	token := auth.RandomToken(18)
	expires := time.Now().Add(time.Duration(body.Hours) * time.Hour)
	if err := s.store.CreateShareLink(r.Context(), token, wsID, expires); err != nil {
		return err
	}
	viewURL := s.cfg.FrontendURL + "/share/" + token
	png, err := qrcode.Encode(viewURL, qrcode.Medium, 512)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{
		"token": token, "url": viewURL, "api_base": s.cfg.PublicAPIURL + "/share/" + token,
		"expires_at": expires, "qr_png_base64": base64.StdEncoding.EncodeToString(png),
	})
	return nil
}

// shareRun resolves a share token (and optional run id) to a run in that workspace.
func (s *Service) shareRun(r *http.Request) (*store.Run, error) {
	wsID, err := s.store.ShareLinkWorkspace(r.Context(), chiParam(r, "token"))
	if err != nil {
		return nil, err
	}
	runID, err := httpx.IDParam(r, "runId")
	if err != nil {
		return nil, err
	}
	run, err := s.store.RunByID(r.Context(), runID)
	if err != nil {
		return nil, err
	}
	if run.WorkspaceID != wsID {
		return nil, store.ErrNotFound
	}
	return run, nil
}

// GET /share/{token} — workspace overview for the read-only live view.
func (s *Service) ShareOverview(w http.ResponseWriter, r *http.Request) error {
	wsID, err := s.store.ShareLinkWorkspace(r.Context(), chiParam(r, "token"))
	if err != nil {
		return err
	}
	ws, err := s.store.WorkspaceByID(r.Context(), wsID)
	if err != nil {
		return err
	}
	runs, err := s.store.RunsForWorkspace(r.Context(), wsID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"workspace": map[string]any{"id": ws.ID, "title": ws.Title, "compute_budget": ws.ComputeBudget, "mode": ws.Mode},
		"runs":      runs,
	})
	return nil
}

// GET /share/{token}/runs/{runId}
func (s *Service) ShareRun(w http.ResponseWriter, r *http.Request) error {
	run, err := s.shareRun(r)
	if err != nil {
		return err
	}
	ws, err := s.store.WorkspaceByID(r.Context(), run.WorkspaceID)
	if err != nil {
		return err
	}
	return s.writeRunDetail(w, r, run, ws)
}

// GET /share/{token}/runs/{runId}/stream
func (s *Service) ShareStream(w http.ResponseWriter, r *http.Request) error {
	run, err := s.shareRun(r)
	if err != nil {
		return err
	}
	return s.stream(w, r, run.ID)
}

// GET /share/{token}/runs/{runId}/events
func (s *Service) ShareEvents(w http.ResponseWriter, r *http.Request) error {
	run, err := s.shareRun(r)
	if err != nil {
		return err
	}
	return s.writeEvents(w, r, run.ID)
}

// shareView exposes a read-only JSON view (scorecard, map, whatif, settings, tasks) through a share link.
func (s *Service) shareView(fn func(context.Context, int64) (json.RawMessage, error)) http.HandlerFunc {
	return httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		run, err := s.shareRun(r)
		if err != nil {
			return err
		}
		data, err := fn(r.Context(), run.ID)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
		return nil
	})
}

// ShareRoutes mounts the public, read-only share endpoints.
func (s *Service) ShareRoutes(r chi.Router) {
	h := httpx.Handler
	r.Get("/share/{token}", h(s.ShareOverview))
	r.Get("/share/{token}/runs/{runId}", h(s.ShareRun))
	r.Get("/share/{token}/runs/{runId}/stream", h(s.ShareStream))
	r.Get("/share/{token}/runs/{runId}/events", h(s.ShareEvents))
	r.Get("/share/{token}/runs/{runId}/scorecard", s.shareView(s.store.Scorecard))
	r.Get("/share/{token}/runs/{runId}/map", s.shareView(s.store.ResearchMap))
	r.Get("/share/{token}/runs/{runId}/whatif", s.shareView(s.store.WhatIfBranches))
	r.Get("/share/{token}/runs/{runId}/settings", s.shareView(s.store.Settings))
	r.Get("/share/{token}/runs/{runId}/tasks", s.shareView(s.store.AgentTasksForRun))
}
