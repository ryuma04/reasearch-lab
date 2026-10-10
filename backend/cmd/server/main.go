package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ryuma04/tapu-sena/backend/internal/agentsclient"
	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/githubpush"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/proof"
	"github.com/ryuma04/tapu-sena/backend/internal/ratelimit"
	"github.com/ryuma04/tapu-sena/backend/internal/runs"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/voice"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
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
	b, err := bus.New(ctx, cfg.RedisURL, st)
	if err != nil {
		return err
	}
	go b.RunIngest(ctx)

	agents := agentsclient.New(cfg.AgentsURL, cfg.InternalToken)
	authSvc := auth.New(cfg, st)
	wsSvc := workspace.New(cfg, st)
	runSvc := runs.New(cfg, st, b, agents)
	sbx := sandbox.New(cfg, st, b)
	proofSvc := proof.New(st)
	rl := ratelimit.New(b.Redis, cfg.RateLimits)
	pushSvc := githubpush.New(cfg, st, b, authSvc)
	voiceSvc := voice.New(cfg, st, agents)

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer)
	r.Use(httpx.CORS(cfg.FrontendURL))
	r.Use(authSvc.Middleware)
	h := httpx.Handler

	r.Get("/healthz", health(cfg, st, b, agents))
	r.Get("/livez", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	// Auth (public)
	r.Get("/auth/github/login", h(authSvc.Login))
	r.Get("/auth/github/callback", h(authSvc.Callback))
	r.Post("/auth/dev-login", h(authSvc.DevLogin))
	r.Post("/auth/logout", h(authSvc.Logout))

	// Public read-only live view (QR code link)
	runSvc.ShareRoutes(r)

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
		r.Post("/workspaces/{id}/share", h(runSvc.CreateShare))
		r.Post("/workspaces/{id}/runs", h(runSvc.Start))
		r.Get("/workspaces/{id}/runs", h(runSvc.ListForWorkspace))

		r.Get("/runs/{id}", h(runSvc.Get))
		r.Get("/runs/{id}/stream", h(runSvc.Stream))
		r.Get("/runs/{id}/events", h(runSvc.Events))
		r.Get("/runs/{id}/checkpoints", h(runSvc.Checkpoints))
		r.Post("/runs/{id}/checkpoints/{name}", h(runSvc.ResolveCheckpoint))
		r.Post("/runs/{id}/agents/{agent}/action", h(runSvc.AgentAction))
		r.Get("/runs/{id}/scorecard", h(runSvc.Scorecard))
		r.Get("/runs/{id}/settings", h(runSvc.Settings))
		r.Get("/runs/{id}/metrics", h(runSvc.Metrics))
		r.Get("/runs/{id}/research", h(runSvc.Research))
		r.Get("/runs/{id}/map", h(runSvc.Map))
		r.Get("/runs/{id}/gap", h(runSvc.Gap))
		r.Get("/runs/{id}/files", h(runSvc.Files))
		r.Get("/runs/{id}/file", h(runSvc.File))
		r.Post("/runs/{id}/whatif", h(runSvc.AskWhatIf))
		r.Get("/runs/{id}/whatif", h(runSvc.ListWhatIf))
		r.Post("/runs/{id}/push", h(pushSvc.Handle))
		r.Get("/runs/{id}/pushes", h(pushSvc.List))
		r.Get("/runs/{id}/push/preview", h(pushSvc.Preview))
		r.Get("/metrics/{id}/proof", h(runSvc.MetricProof))
		r.Get("/papers/{id}/pdf", h(runSvc.PaperPDF))

		r.Get("/agents", func(w http.ResponseWriter, r *http.Request) { httpx.JSON(w, http.StatusOK, runs.Agents) })
		r.Get("/memory/search", h(runSvc.MemorySearch))

		r.Post("/voice/command", h(voiceSvc.Command))
		r.Post("/voice/text", h(voiceSvc.Text))
	})

	// Internal routes: agent worker and n8n only (X-Internal-Token)
	r.Route("/internal", func(r chi.Router) {
		r.Use(authSvc.RequireInternal)
		r.Post("/sandbox/exec", h(sbx.HandleExec))
		r.Post("/proof/check", h(proofSvc.Handle))
		r.Post("/ratelimit/acquire", h(rl.Handle))
		r.Get("/ratelimit/usage", h(rl.Usage))
		r.Post("/push/callback", h(pushSvc.Callback))
	})

	srv := &http.Server{Addr: cfg.Addr, Handler: r, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	slog.Info("api listening", "addr", cfg.Addr, "data_dir", cfg.DataDir, "agents_url", cfg.AgentsURL,
		"github_oauth", cfg.GitHubConfigured(), "sandbox", cfg.SandboxMode)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// health reports every connection: database, Redis, agent service, Docker + sandbox image,
// n8n, and which external credentials are configured.
func health(cfg *config.Config, st *store.Store, b *bus.Bus, agents *agentsclient.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		check := func(err error) map[string]any {
			if err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
			return map[string]any{"ok": true}
		}
		out := map[string]any{}
		out["database"] = check(st.Pool.Ping(ctx))
		out["redis"] = check(b.Redis.Ping(ctx).Err())
		if ah, err := agents.Health(ctx); err != nil {
			out["agents_service"] = check(err)
		} else {
			ah["ok"] = true
			out["agents_service"] = ah
		}
		sb := map[string]any{"mode": cfg.SandboxMode, "ok": true}
		if cfg.SandboxMode == "docker" {
			sb["docker"] = sandbox.DockerAvailable(ctx)
			sb["image"] = cfg.SandboxImagePython
			sb["image_present"] = exec.CommandContext(ctx, "docker", "image", "inspect", cfg.SandboxImagePython).Run() == nil
			sb["ok"] = sb["docker"] == true && sb["image_present"] == true
		}
		out["sandbox"] = sb
		n8n := map[string]any{"configured": cfg.N8NWebhookURL != "", "direct_fallback": cfg.PushDirectFallback}
		out["n8n"] = n8n
		out["credentials"] = map[string]any{
			"github_oauth": cfg.GitHubConfigured(), "groq": cfg.GroqAPIKey != "", "gemini": cfg.GeminiAPIKey != "",
			"dev_login": cfg.DevLoginEnabled,
		}
		ok := out["database"].(map[string]any)["ok"] == true && out["redis"].(map[string]any)["ok"] == true
		out["ok"] = ok
		status := http.StatusOK
		if !ok {
			status = http.StatusServiceUnavailable
		}
		httpx.JSON(w, status, out)
	}
}
