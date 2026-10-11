package mcp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// LabListWorkspacesIn has no arguments: it lists what the caller can access.
type LabListWorkspacesIn struct{}

// LabStartRunIn starts the agent team on a workspace (same rules as the Start run button).
type LabStartRunIn struct {
	WorkspaceID   int64  `json:"workspace_id"`
	ComputeBudget string `json:"compute_budget,omitempty" jsonschema:"optional; quick, standard or deep (default: the workspace's budget)"`
}

const maxPaperBytes = 50 << 20

var (
	arxivRe    = regexp.MustCompile(`(?i)(?:arxiv\.org/(?:abs|pdf)/|arxiv:)?\s*(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/?$`)
	unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
)

// handleLabListWorkspaces is the entry point for an MCP client: every other tool needs a run_id, and this is where
// the client finds the user's workspaces, their papers and their runs (newest first).
func (s *Server) handleLabListWorkspaces(ctx context.Context, _ LabListWorkspacesIn) (any, error) {
	if s.user == nil {
		return nil, errors.New("unauthorized")
	}
	list, err := s.store.WorkspacesForUser(ctx, s.user.ID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(list))
	for _, w := range list {
		runs, err := s.store.RunsForWorkspace(ctx, w.ID)
		if err != nil {
			return nil, err
		}
		rs := make([]map[string]any, 0, len(runs))
		for _, r := range runs { // already newest first
			rs = append(rs, map[string]any{"run_id": r.ID, "status": r.Status, "stage": r.Stage, "kind": r.Kind, "started_at": r.StartedAt})
		}
		ups, err := s.store.UploadsForWorkspace(ctx, w.ID)
		if err != nil {
			return nil, err
		}
		papers := []string{}
		for _, u := range ups {
			if u.Kind == "paper" {
				name := u.OriginalName
				if name == "" {
					name = u.PathOrURL
				}
				papers = append(papers, name)
			}
		}
		out = append(out, map[string]any{"workspace_id": w.ID, "title": w.Title, "role": w.Role, "papers": papers, "runs": rs,
			"app_url": fmt.Sprintf("%s/workspaces/%d", s.cfg.FrontendURL, w.ID)})
	}
	return map[string]any{"workspaces": out, "count": len(out),
		"hint": "Use a run_id from here with the paper_*, workspace_*, sandbox_*, experiment_* and debugger_* tools."}, nil
}

// handlePaperUpload attaches a PDF from this machine's disk or an arXiv paper to one of the caller's workspaces, or to a
// new workspace owned by the caller. It does not start a run (use lab_start_run), and it never touches another user's
// workspace: workspace_id is checked by the authorization middleware (editor role).
func (s *Server) handlePaperUpload(ctx context.Context, in PaperUploadIn) (any, error) {
	if s.user == nil || s.user.ID <= 0 {
		return nil, errors.New("unauthorized")
	}
	var data []byte
	var filename, link string
	switch {
	case in.FilePath != "":
		p := filepath.Clean(strings.Trim(strings.TrimSpace(in.FilePath), `"'`))
		if !strings.EqualFold(filepath.Ext(p), ".pdf") {
			return nil, fmt.Errorf("%s is not a .pdf file", p)
		}
		st, err := os.Stat(p)
		if err != nil {
			return nil, fmt.Errorf("cannot read %s: %w", p, err)
		}
		if st.IsDir() || st.Size() > maxPaperBytes {
			return nil, fmt.Errorf("%s must be a PDF file of at most 50 MB", p)
		}
		if data, err = os.ReadFile(p); err != nil {
			return nil, fmt.Errorf("cannot read %s: %w", p, err)
		}
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			return nil, fmt.Errorf("%s is not a PDF file", p)
		}
		filename = filepath.Base(p)
	case in.ArxivOrURL != "":
		m := arxivRe.FindStringSubmatch(strings.TrimSpace(in.ArxivOrURL))
		if m == nil {
			return nil, fmt.Errorf("only arXiv papers can be linked (e.g. https://arxiv.org/abs/1503.02531); for another paper pass file_path")
		}
		link = "https://arxiv.org/abs/" + m[1]
	default:
		return nil, errors.New("provide file_path (a PDF on this machine) or arxiv_or_url")
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		if filename != "" {
			title = strings.TrimSuffix(strings.ReplaceAll(filename, "_", " "), filepath.Ext(filename))
		} else {
			title = "arXiv " + strings.TrimPrefix(link, "https://arxiv.org/abs/")
		}
	}

	var wsID int64
	created := false
	if in.WorkspaceID != nil && *in.WorkspaceID > 0 {
		wsID = *in.WorkspaceID
	} else {
		ws, err := s.store.CreateWorkspace(ctx, s.user.ID, title, "quick", "reproduce", "Created from an MCP client (Gemini CLI)")
		if err != nil {
			return nil, fmt.Errorf("create workspace: %w", err)
		}
		wsID, created = ws.ID, true
	}

	u := &store.Upload{WorkspaceID: wsID, Kind: "paper"}
	if data != nil {
		name := strings.Trim(unsafeName.ReplaceAllString(filename, "_"), "._")
		if name == "" {
			name = "paper.pdf"
		}
		rel := filepath.ToSlash(filepath.Join("workspaces", fmt.Sprint(wsID), "uploads", "papers", auth.RandomToken(6)+"_"+name))
		dst := filepath.Join(s.cfg.DataDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return nil, fmt.Errorf("save paper: %w", err)
		}
		u.PathOrURL, u.OriginalName, u.SizeBytes = rel, filename, int64(len(data))
	} else {
		u.PathOrURL = link
	}
	if err := s.store.CreateUpload(ctx, u); err != nil {
		return nil, fmt.Errorf("record upload: %w", err)
	}
	return map[string]any{
		"status": "uploaded", "workspace_id": wsID, "workspace_created": created, "upload_id": u.ID, "title": title,
		"app_url": fmt.Sprintf("%s/workspaces/%d", s.cfg.FrontendURL, wsID),
		"next":    fmt.Sprintf("Call lab_start_run with workspace_id %d to start the agent team (paper reading, planning, coding, sandbox runs, tests).", wsID),
	}, nil
}

// handleLabStartRun queues a run exactly like the website's Start run button: editor role (checked by the middleware),
// at least one paper, and one active run per workspace (an active run is returned instead of starting a second one).
func (s *Server) handleLabStartRun(ctx context.Context, in LabStartRunIn) (any, error) {
	if s.user == nil || s.user.ID <= 0 {
		return nil, errors.New("unauthorized")
	}
	ws, err := s.store.WorkspaceForUser(ctx, in.WorkspaceID, s.user.ID)
	if err != nil {
		return nil, err
	}
	budget := in.ComputeBudget
	if budget == "" {
		budget = ws.ComputeBudget
	}
	if budget != "quick" && budget != "standard" && budget != "deep" {
		return nil, errors.New("compute_budget must be quick, standard or deep")
	}
	n, err := s.store.CountPapers(ctx, ws.ID)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, errors.New("upload at least one research paper first (paper_upload_or_link)")
	}
	run, created, err := s.store.CreateRunIfIdle(ctx, ws.ID, budget)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/workspaces/%d/run/%d", s.cfg.FrontendURL, ws.ID, run.ID)
	if !created {
		return map[string]any{"run_id": run.ID, "status": run.Status, "started": false, "app_url": url,
			"message": "A run is already active in this workspace; follow it instead of starting a second one."}, nil
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "start_run", "run_id": run.ID, "user_id": s.user.ID}); err != nil {
		_ = s.store.SetRunStatus(ctx, run.ID, "failed", "", "could not queue the run: "+err.Error())
		return nil, fmt.Errorf("could not reach the agent worker: %w", err)
	}
	return map[string]any{"run_id": run.ID, "status": run.Status, "started": true, "budget": budget, "app_url": url,
		"message": "The agent team started. The researcher approves the plan in the app (checkpoint 1). Follow it with lab_list_workspaces (status, stage) and paper_get_claims with this run_id."}, nil
}
