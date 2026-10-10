package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ryuma04/tapu-sena/services/api/internal/auth"
	"github.com/ryuma04/tapu-sena/services/api/internal/config"
	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
	"github.com/ryuma04/tapu-sena/services/api/internal/workspace"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return err
	}

	authSvc := auth.New(cfg, st)
	wsSvc := workspace.New(cfg, st)

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer)
	r.Use(httpx.CORS(cfg.FrontendURL))
	r.Use(authSvc.Middleware)

	h := httpx.Handler
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": true, "github_oauth": cfg.GitHubConfigured(), "dev_login": cfg.DevLoginEnabled,
			"sandbox_mode": cfg.SandboxMode, "telegram": cfg.TelegramConfigured(),
		})
	})

	// Auth
	r.Get("/auth/github/login", h(authSvc.Login))
	r.Get("/auth/github/callback", h(authSvc.Callback))
	r.Post("/auth/dev-login", h(authSvc.DevLogin))
	r.Post("/auth/logout", h(authSvc.Logout))

	// Logged-in routes
	r.Group(func(r chi.Router) {
		r.Use(auth.Require)

		r.Get("/me", h(authSvc.Me))
		r.Get("/github/repos", h(authSvc.ListRepos))
		r.Post("/github/repos", h(authSvc.CreateRepo))
		r.Put("/github/default-repo", h(authSvc.SetDefaultRepo))
		r.Delete("/github/connection", h(authSvc.Disconnect))

		r.Post("/workspaces", h(wsSvc.Create))
		r.Get("/workspaces", h(wsSvc.List))
		r.Get("/workspaces/{id}", h(wsSvc.Get))
		r.Patch("/workspaces/{id}", h(wsSvc.Update))
		r.Post("/workspaces/{id}/uploads", h(wsSvc.CreateUpload))
		r.Get("/workspaces/{id}/uploads", h(wsSvc.ListUploads))
		r.Get("/workspaces/{id}/uploads/{uploadId}/file", h(wsSvc.DownloadUpload))
		r.Delete("/workspaces/{id}/uploads/{uploadId}", h(wsSvc.DeleteUpload))
		r.Get("/workspaces/{id}/notes", h(wsSvc.GetNotes))
		r.Put("/workspaces/{id}/notes", h(wsSvc.PutNotes))
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	slog.Info("api listening", "addr", cfg.Addr, "data_dir", cfg.DataDir, "github_oauth", cfg.GitHubConfigured())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
