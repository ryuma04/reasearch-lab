package hfpublish

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

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

func New(cfg *config.Config, st *store.Store, b *bus.Bus) *Service { return &Service{cfg: cfg, store: st, bus: b} }

// Routes registers the logged-in routes.
func (s *Service) Routes(r interface {
	Get(string, http.HandlerFunc)
	Post(string, http.HandlerFunc)
}) {
	h := httpx.Handler
	r.Get("/runs/{id}/huggingface/preview", h(s.Preview))
	r.Post("/runs/{id}/huggingface", h(s.Publish))
	r.Get("/runs/{id}/huggingface", h(s.List))
}

func (s *Service) runFor(r *http.Request, minRole string) (*store.Run, *store.Workspace, error) {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return nil, nil, err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return nil, nil, err
	}
	ws, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, minRole)
	if err != nil {
		return nil, nil, err
	}
	return run, ws, nil
}

// Plan is what the researcher sees before confirming.
type Plan struct {
	Configured    bool       `json:"configured"` // HF_TOKEN is set on the server (never its value)
	SourceExecID  int64      `json:"source_exec_id"`
	Files         []FileItem `json:"files"`
	Excluded      []Excluded `json:"excluded"`
	Blockers      []string   `json:"blockers"`
	ModelCard     string     `json:"model_card"`
	SuggestedRepo string     `json:"suggested_repo"`
	TotalBytes    int64      `json:"total_bytes"`
}

// plan builds the upload plan from the run's latest verified execution.
func (s *Service) plan(ctx context.Context, run *store.Run, ws *store.Workspace, repo string, includeCode bool) (*Plan, error) {
	p := &Plan{Configured: s.cfg.HFToken != "", Files: []FileItem{}, Excluded: []Excluded{}, Blockers: []string{}}
	if !p.Configured {
		p.Blockers = append(p.Blockers, "Hugging Face is not set up on the server: add HF_TOKEN to .env and restart")
	}
	if run.Status == "queued" || run.Status == "running" {
		p.Blockers = append(p.Blockers, "the run is still working; publish when it has finished or is waiting for you")
	}
	var execID int64
	var artsRaw []byte
	var finished *time.Time
	var codeVersion string
	err := s.store.Pool.QueryRow(ctx, `SELECT id, artifacts, finished_at, code_version FROM sandbox_execs
		WHERE run_id=$1 AND phase='execute' AND status='succeeded' AND metrics_status='valid'
		ORDER BY id DESC LIMIT 1`, run.ID).Scan(&execID, &artsRaw, &finished, &codeVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		p.Blockers = append(p.Blockers, "no successful run with verified results yet: run the experiment first")
		return p, nil
	}
	if err != nil {
		return nil, err
	}
	p.SourceExecID = execID
	var arts []sandbox.Artifact
	_ = json.Unmarshal(artsRaw, &arts)
	project := filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(run.WorkspaceID, run.ID)))
	sel, err := Select(ctx, project, arts, includeCode, s.cfg.SandboxMaxArtifactMB<<20, s.cfg.GitleaksBin)
	if err != nil {
		return nil, err
	}
	p.Files, p.Excluded = sel.Files, sel.Excluded
	p.Blockers = append(p.Blockers, sel.Blockers...)
	for _, f := range p.Files {
		p.TotalBytes += f.Size
	}
	p.SuggestedRepo = suggestName(ws.Title, run.ID)
	if repo == "" {
		repo = p.SuggestedRepo
	}
	card, err := s.cardInfo(ctx, run, ws, execID, codeVersion, finished, repo, p.Files)
	if err != nil {
		return nil, err
	}
	p.ModelCard = BuildModelCard(card)
	return p, nil
}

func suggestName(title string, runID int64) string {
	var b strings.Builder
	for _, r := range strings.ToLower(title) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case b.Len() > 0 && !strings.HasSuffix(b.String(), "-"):
			b.WriteByte('-')
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "reproduction"
	}
	if len(base) > 60 {
		base = strings.Trim(base[:60], "-")
	}
	return fmt.Sprintf("%s-run-%d", base, runID)
}

func (s *Service) cardInfo(ctx context.Context, run *store.Run, ws *store.Workspace, execID int64, codeVersion string, finished *time.Time, repo string, files []FileItem) (CardInfo, error) {
	c := CardInfo{RepoID: repo, Title: ws.Title, RunID: run.ID, ExecID: execID, CodeVersion: codeVersion, FinishedAt: finished, Files: files}
	if c.CodeVersion == "" {
		c.CodeVersion = run.GitCommit
	}
	collect := func(sql string, args []any, scan func(pgx.Rows) error) error {
		rows, err := s.store.Pool.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	if err := collect(`SELECT title, arxiv_id FROM papers WHERE workspace_id=$1 ORDER BY id`, []any{run.WorkspaceID}, func(r pgx.Rows) error {
		var p CardPaper
		err := r.Scan(&p.Title, &p.ArxivID)
		c.Papers = append(c.Papers, p)
		return err
	}); err != nil {
		return c, err
	}
	if err := collect(`SELECT name, value, source, source_ref FROM settings WHERE run_id=$1 ORDER BY name`, []any{run.ID}, func(r pgx.Rows) error {
		var st CardSetting
		err := r.Scan(&st.Name, &st.Value, &st.Source, &st.SourceRef)
		c.Settings = append(c.Settings, st)
		return err
	}); err != nil {
		return c, err
	}
	if err := collect(`SELECT name, value FROM metrics WHERE exec_id=$1 ORDER BY name`, []any{execID}, func(r pgx.Rows) error {
		var m CardMetric
		err := r.Scan(&m.Name, &m.Value)
		c.Metrics = append(c.Metrics, m)
		return err
	}); err != nil {
		return c, err
	}
	err := collect(`SELECT c.metric_name, c.description, c.value, c.page FROM claims c JOIN papers p ON p.id=c.paper_id
		WHERE p.workspace_id=$1 AND c.metric_name <> '' ORDER BY c.id`, []any{run.WorkspaceID}, func(r pgx.Rows) error {
		var cl CardClaim
		err := r.Scan(&cl.MetricName, &cl.Description, &cl.Value, &cl.Page)
		c.Claims = append(c.Claims, cl)
		return err
	})
	return c, err
}

// GET /runs/{id}/huggingface/preview?repo=&include_code=1 — files, exclusions, blockers and the model card.
func (s *Service) Preview(w http.ResponseWriter, r *http.Request) error {
	run, ws, err := s.runFor(r, "editor")
	if err != nil {
		return err
	}
	repo := strings.TrimSpace(r.URL.Query().Get("repo"))
	if repo != "" {
		if repo, err = ValidateRepoName(repo); err != nil {
			return httpx.Errorf(http.StatusBadRequest, err.Error())
		}
	}
	p, err := s.plan(r.Context(), run, ws, repo, r.URL.Query().Get("include_code") == "1")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, p)
	return nil
}

// Publication is a stored publish request and its Hub-confirmed result.
type Publication struct {
	ID         int64           `json:"id"`
	RunID      int64           `json:"run_id"`
	RepoName   string          `json:"repo_name"`
	RepoID     string          `json:"repo_id"`
	Private    bool            `json:"private"`
	Status     string          `json:"status"`
	Stage      string          `json:"stage"`
	Files      json.RawMessage `json:"files"`
	FilesDone  int             `json:"files_done"`
	FilesTotal int             `json:"files_total"`
	BytesDone  int64           `json:"bytes_done"`
	BytesTotal int64           `json:"bytes_total"`
	RepoURL    string          `json:"repo_url"`
	CommitURL  string          `json:"commit_url"`
	Error      string          `json:"error"`
	CreatedAt  time.Time       `json:"created_at"`
	FinishedAt *time.Time      `json:"finished_at"`
}

const pubCols = `id, run_id, repo_name, repo_id, private, status, stage, files, files_done, files_total, bytes_done,
	bytes_total, repo_url, commit_url, error, created_at, finished_at`

func scanPub(row pgx.Row) (*Publication, error) {
	p := &Publication{}
	err := row.Scan(&p.ID, &p.RunID, &p.RepoName, &p.RepoID, &p.Private, &p.Status, &p.Stage, &p.Files, &p.FilesDone,
		&p.FilesTotal, &p.BytesDone, &p.BytesTotal, &p.RepoURL, &p.CommitURL, &p.Error, &p.CreatedAt, &p.FinishedAt)
	return p, err
}

// POST /runs/{id}/huggingface {"repo": "my-model", "private": true, "include_code": false, "confirm": true}
func (s *Service) Publish(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	run, ws, err := s.runFor(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Repo        string `json:"repo"`
		Private     *bool  `json:"private"`
		IncludeCode bool   `json:"include_code"`
		Confirm     bool   `json:"confirm"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !body.Confirm {
		return httpx.Errorf(http.StatusBadRequest, "confirm the files before publishing")
	}
	if body.Private == nil {
		return httpx.Errorf(http.StatusBadRequest, "choose public or private")
	}
	repo, err := ValidateRepoName(body.Repo)
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, err.Error())
	}
	// The file list is rebuilt here, never taken from the browser.
	p, err := s.plan(ctx, run, ws, repo, body.IncludeCode)
	if err != nil {
		return err
	}
	if len(p.Blockers) > 0 {
		return httpx.Errorf(http.StatusConflict, "cannot publish yet: "+strings.Join(p.Blockers, "; "))
	}
	if err := s.failStale(ctx, run.ID); err != nil {
		return err
	}
	files, _ := json.Marshal(p.Files)
	pub, err := scanPub(s.store.Pool.QueryRow(ctx, `
		INSERT INTO hf_publications (run_id, user_id, source_exec_id, repo_name, private, files, model_card, files_total, bytes_total)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+pubCols,
		run.ID, auth.UserID(ctx), p.SourceExecID, repo, *body.Private, files, p.ModelCard, len(p.Files)+1, p.TotalBytes+int64(len(p.ModelCard))))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return httpx.Errorf(http.StatusConflict, "a publication is already in progress for this run")
	}
	if err != nil {
		return err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "hf_publish", "run_id": run.ID, "publication_id": pub.ID}); err != nil {
		_, _ = s.store.Pool.Exec(context.WithoutCancel(ctx), `DELETE FROM hf_publications WHERE id=$1`, pub.ID)
		return httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
	}
	vis := "public"
	if *body.Private {
		vis = "private"
	}
	s.bus.Emit(ctx, store.Event{RunID: run.ID, Agent: "researcher", Type: "hf_publish_requested",
		Message: fmt.Sprintf("Publishing %d files to Hugging Face (%s repository %s)", len(p.Files)+1, vis, repo),
		Why:     "Approved by the researcher", Links: json.RawMessage(fmt.Sprintf(`{"publication_id":%d}`, pub.ID))})
	httpx.JSON(w, http.StatusAccepted, pub)
	return nil
}

// StaleQueuedAfter is how long a publication may wait for the agent worker before it is failed.
const StaleQueuedAfter = "3 minutes"

const StaleQueuedMessage = "The upload never started: the agents worker did not pick it up. Check that the agents service " +
	"is running with the latest code (restart it if needed), then publish again. Nothing was uploaded."

// failStale never leaves the researcher waiting forever: a publication no worker started is a failure.
func (s *Service) failStale(ctx context.Context, runID int64) error {
	_, err := s.store.Pool.Exec(ctx, `UPDATE hf_publications SET status='failed', stage='failed', finished_at=now(),
		error=$2 WHERE run_id=$1 AND status='queued' AND created_at < now() - $3::interval`, runID, StaleQueuedMessage, StaleQueuedAfter)
	return err
}

// GET /runs/{id}/huggingface — publications, newest first, with progress and the Hub link.
func (s *Service) List(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.runFor(r, "viewer")
	if err != nil {
		return err
	}
	if err := s.failStale(r.Context(), run.ID); err != nil {
		return err
	}
	rows, err := s.store.Pool.Query(r.Context(), `SELECT `+pubCols+` FROM hf_publications WHERE run_id=$1 ORDER BY id DESC LIMIT 20`, run.ID)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (*Publication, error) { return scanPub(row) })
	if err != nil {
		return err
	}
	if list == nil {
		list = []*Publication{}
	}
	httpx.JSON(w, http.StatusOK, list)
	return nil
}
