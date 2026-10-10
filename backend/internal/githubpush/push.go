// Package githubpush implements Checkpoint 2: approve push -> secret scan -> n8n workflow
// (one meaningful commit per stage, what-ifs on their own branches) -> callback.
// If n8n is unreachable, the same commits are pushed directly through the GitHub API.
package githubpush

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/ghapi"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

type Service struct {
	cfg   *config.Config
	store *store.Store
	bus   *bus.Bus
	auth  *auth.Service
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus, a *auth.Service) *Service {
	return &Service{cfg: cfg, store: st, bus: b, auth: a}
}

func (s *Service) event(ctx context.Context, runID int64, typ, msg, why string, links map[string]any) {
	l, _ := json.Marshal(links)
	s.bus.Emit(ctx, store.Event{RunID: runID, Agent: "github", Type: typ, Message: msg, Why: why, Links: l})
}

// POST /runs/{id}/push {"repo": "owner/name" (optional; default repo otherwise)}
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "editor"); err != nil {
		return err
	}
	var body struct {
		Repo string `json:"repo"`
	}
	if r.ContentLength > 0 {
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
	}
	pushID, err := s.Start(r.Context(), run, auth.UserID(r.Context()), body.Repo, "web")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"push_id": pushID, "status": "pending"})
	return nil
}

// Start validates and launches a push in the background. Used by the web API.
func (s *Service) Start(ctx context.Context, run *store.Run, userID int64, repo, via string) (int64, error) {
	if run.Kind != "main" {
		return 0, httpx.Errorf(http.StatusBadRequest, "push the main run; what-if branches are included automatically")
	}
	if run.Status != "completed" {
		return 0, httpx.Errorf(http.StatusConflict, "the run must be completed before pushing (status: "+run.Status+")")
	}
	token, err := s.auth.GitHubToken(ctx, userID)
	if err != nil {
		return 0, err // 428: ask the researcher to connect GitHub first
	}
	if repo == "" {
		conn, err := s.store.GitHubConnection(ctx, userID)
		if err != nil {
			return 0, err
		}
		repo = conn.DefaultRepo
	}
	if repo == "" || !strings.Contains(repo, "/") {
		return 0, httpx.Errorf(http.StatusPreconditionFailed, "choose or create a repository first (PUT /github/default-repo)")
	}
	// A push whose n8n callback never arrived must not block every later push (audit REL-02).
	if tag, err := s.store.Pool.Exec(ctx, `UPDATE pushes SET status='failed', finished_at=now(),
		error='timed out: the push workflow never reported back' WHERE run_id=$1 AND status IN ('pending','pushing')
		AND created_at < now() - interval '20 minutes'`, run.ID); err == nil && tag.RowsAffected() > 0 {
		s.event(ctx, run.ID, "push_failed", "A previous push timed out and was marked failed", "", nil)
	}
	var active bool
	_ = s.store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pushes WHERE run_id=$1 AND status IN ('pending','pushing'))`, run.ID).Scan(&active)
	if active {
		return 0, httpx.Errorf(http.StatusConflict, "a push for this run is already in progress")
	}
	var pushID int64
	if err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO pushes (run_id, user_id, repo_url, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
		run.ID, userID, "https://github.com/"+repo).Scan(&pushID); err != nil {
		return 0, err
	}
	s.event(ctx, run.ID, "push_started", "Push to "+repo+" approved via "+via, "Checkpoint 2: the researcher approved the push",
		map[string]any{"push_id": pushID, "repo": repo})
	go s.process(context.WithoutCancel(ctx), run, pushID, token, repo)
	return pushID, nil
}

func (s *Service) fail(ctx context.Context, runID, pushID int64, status, msg string) {
	_, _ = s.store.Pool.Exec(ctx, `UPDATE pushes SET status=$2, error=$3, finished_at=now() WHERE id=$1`, pushID, status, msg)
	typ := "push_failed"
	if status == "blocked" {
		typ = "push_blocked"
	}
	s.event(ctx, runID, typ, msg, "", map[string]any{"push_id": pushID})
}

func (s *Service) process(ctx context.Context, run *store.Run, pushID int64, token, repo string) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()

	ws, err := s.store.WorkspaceByID(ctx, run.WorkspaceID)
	if err != nil {
		s.fail(ctx, run.ID, pushID, "failed", "workspace not found")
		return
	}
	gh := &ghapi.Client{Token: token}
	repoInfo, err := gh.GetRepo(ctx, repo)
	if err != nil {
		s.fail(ctx, run.ID, pushID, "failed", "cannot access repository "+repo+": "+err.Error())
		return
	}
	branch := repoInfo.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	b, err := s.BuildBundle(ctx, run, ws, repo, branch)
	if err != nil {
		s.fail(ctx, run.ID, pushID, "failed", "could not build the bundle: "+err.Error())
		return
	}

	scan, err := Scan(ctx, s.cfg.GitleaksBin, b.Files)
	if err != nil {
		s.fail(ctx, run.ID, pushID, "failed", "secret scan failed: "+err.Error())
		return
	}
	scanJSON, _ := json.Marshal(scan)
	_, _ = s.store.Pool.Exec(ctx, `UPDATE pushes SET secret_scan_result=$2, status='pushing' WHERE id=$1`, pushID, scanJSON)
	if !scan.Clean {
		f := scan.Findings[0]
		s.fail(ctx, run.ID, pushID, "blocked",
			fmt.Sprintf("Push blocked: %d possible secret(s) found, e.g. %s at %s line %d", len(scan.Findings), f.Description, f.File, f.Line))
		return
	}
	s.event(ctx, run.ID, "secret_scan_passed", fmt.Sprintf("Secret scan (%s) passed on %d files", scan.Scanner, len(b.Files)), "", map[string]any{"push_id": pushID})

	commits := b.Commits(branch)
	if s.cfg.N8NWebhookURL != "" {
		err := s.sendToN8N(ctx, pushID, run.ID, token, repo, branch, commits)
		if err == nil {
			_, _ = s.store.Pool.Exec(ctx, `UPDATE pushes SET method='n8n' WHERE id=$1`, pushID)
			s.event(ctx, run.ID, "push_n8n", "n8n workflow is creating the commits", "", map[string]any{"push_id": pushID})
			return // n8n calls /internal/push/callback when done
		}
		slog.Warn("n8n push failed", "push_id", pushID, "err", err)
		if !s.cfg.PushDirectFallback {
			s.fail(ctx, run.ID, pushID, "failed", "n8n workflow failed: "+err.Error())
			return
		}
		s.event(ctx, run.ID, "push_fallback", "n8n is unavailable; pushing directly through the GitHub API", err.Error(), map[string]any{"push_id": pushID})
	}

	results, err := gh.PushCommits(ctx, repo, branch, commits)
	if err != nil {
		s.fail(ctx, run.ID, pushID, "failed", "GitHub push failed: "+err.Error())
		return
	}
	s.complete(ctx, run.ID, pushID, "direct", "https://github.com/"+repo, results)
}

func (s *Service) complete(ctx context.Context, runID, pushID int64, method, repoURL string, results []ghapi.CommitResult) {
	urls, _ := json.Marshal(results)
	_, _ = s.store.Pool.Exec(ctx, `
		UPDATE pushes SET status='done', method=COALESCE(NULLIF($2,''), method), repo_url=$3, commit_urls=$4, finished_at=now()
		WHERE id=$1`, pushID, method, repoURL, urls)
	_ = s.store.SetRunStatus(ctx, runID, "completed", "done", "")
	s.event(ctx, runID, "push_done", fmt.Sprintf("Pushed %d commits to %s", len(results), repoURL), "",
		map[string]any{"push_id": pushID, "repo_url": repoURL, "commits": results})
}

type n8nFile struct {
	Path    string `json:"path"`
	Content string `json:"content_base64"`
}

type n8nCommit struct {
	Branch     string    `json:"branch"`
	FromBranch string    `json:"from_branch,omitempty"`
	Message    string    `json:"message"`
	Files      []n8nFile `json:"files"`
}

// sendToN8N posts the bundle to the n8n webhook. The GitHub token travels only in this request;
// the workflow is configured not to save execution data.
func (s *Service) sendToN8N(ctx context.Context, pushID, runID int64, token, repo, branch string, commits []ghapi.CommitSpec) error {
	payload := map[string]any{
		"push_id": pushID, "run_id": runID, "repo": repo, "base_branch": branch, "github_token": token,
		"callback_url":   s.cfg.PublicAPIURL + "/internal/push/callback",
		"callback_token": s.cfg.InternalToken,
	}
	if strings.Contains(s.cfg.N8NWebhookURL, "://n8n:") {
		payload["callback_url"] = "http://api:8080/internal/push/callback" // inside the compose network
	}
	cs := make([]n8nCommit, 0, len(commits))
	for _, c := range commits {
		nc := n8nCommit{Branch: c.Branch, FromBranch: c.FromBranch, Message: c.Message}
		for _, f := range c.Files {
			nc.Files = append(nc.Files, n8nFile{Path: f.Path, Content: base64.StdEncoding.EncodeToString(f.Content)})
		}
		cs = append(cs, nc)
	}
	payload["commits"] = cs
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.N8NWebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2000))
		return fmt.Errorf("n8n webhook returned %d: %s", resp.StatusCode, msg)
	}
	return nil
}

// POST /internal/push/callback (n8n only)
// {"push_id": 1, "status": "done"|"failed", "repo_url": "...", "commits": [{branch, sha, url, message}], "error": "..."}
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		PushID  int64                `json:"push_id"`
		Status  string               `json:"status"`
		RepoURL string               `json:"repo_url"`
		Commits []ghapi.CommitResult `json:"commits"`
		Error   string               `json:"error"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	var runID int64
	err := s.store.Pool.QueryRow(r.Context(), `SELECT run_id FROM pushes WHERE id=$1 AND status='pushing'`, body.PushID).Scan(&runID)
	if err != nil {
		return httpx.Errorf(http.StatusNotFound, "no push in progress with that id")
	}
	ctx := context.WithoutCancel(r.Context())
	if body.Status == "done" {
		s.complete(ctx, runID, body.PushID, "n8n", body.RepoURL, body.Commits)
	} else {
		if body.Error == "" {
			body.Error = "n8n workflow reported a failure"
		}
		s.fail(ctx, runID, body.PushID, "failed", body.Error)
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"ok": "true"})
	return nil
}

// GET /runs/{id}/pushes
func (s *Service) List(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "viewer"); err != nil {
		return err
	}
	data, err := s.store.QueryJSON(r.Context(), `
		SELECT id, run_id, repo_url, commit_urls, status, method, secret_scan_result, error, created_at, finished_at
		FROM pushes WHERE run_id=$1 ORDER BY id DESC`, id)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
	return nil
}

// GET /runs/{id}/push/preview — what would be pushed (files, commits, scan) without pushing.
func (s *Service) Preview(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return err
	}
	ws, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "viewer")
	if err != nil {
		return err
	}
	b, err := s.BuildBundle(r.Context(), run, ws, "", "main")
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return err
		}
		return httpx.Errorf(http.StatusConflict, err.Error())
	}
	scan, err := Scan(r.Context(), s.cfg.GitleaksBin, b.Files)
	if err != nil {
		return err
	}
	type c struct {
		Branch  string   `json:"branch"`
		Message string   `json:"message"`
		Files   []string `json:"files"`
	}
	var commits []c
	for _, cm := range b.Commits("main") {
		cc := c{Branch: cm.Branch, Message: cm.Message}
		for _, f := range cm.Files {
			cc.Files = append(cc.Files, f.Path)
		}
		commits = append(commits, cc)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"commits": commits, "skipped": b.Skipped, "secret_scan": scan,
		"readme": string(b.Files["README.md"])})
	return nil
}
