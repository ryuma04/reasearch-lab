package mcp

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/hfpublish"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type PublishValidateArtifactsIn struct {
	RunID int64 `json:"run_id"`
}

type PublishGenerateModelCardIn struct {
	RunID  int64  `json:"run_id"`
	RepoID string `json:"repo_id,omitempty" jsonschema:"e.g. username/model-name"`
}

type PublishToHuggingFaceIn struct {
	RunID    int64  `json:"run_id"`
	RepoName string `json:"repo_name" jsonschema:"repo name on Hugging Face e.g. cifar-reproduction"`
	Private  bool   `json:"private,omitempty"`
	Approved bool   `json:"approved" jsonschema:"explicit researcher approval flag for public/remote write"`
}

type PublishToGitHubIn struct {
	RunID    int64  `json:"run_id"`
	RepoName string `json:"repo_name,omitempty" jsonschema:"optional GitHub repo name; uses default repo if omitted"`
	Approved bool   `json:"approved" jsonschema:"explicit researcher approval flag for remote git push"`
}

func (s *Server) handlePublishValidateArtifacts(ctx context.Context, in PublishValidateArtifactsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	projectDir := s.projectDir(run.ID)
	modelsDir := filepath.Join(projectDir, "models")

	type ModelFile struct {
		Path   string `json:"path"`
		Size   int64  `json:"size"`
		Format string `json:"format"`
	}

	modelFiles := make([]ModelFile, 0)
	_ = filepath.WalkDir(modelsDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(projectDir, p)
		if err != nil {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		info, err := d.Info()
		if err != nil {
			return nil
		}
		modelFiles = append(modelFiles, ModelFile{
			Path:   filepath.ToSlash(rel),
			Size:   info.Size(),
			Format: ext,
		})
		return nil
	})

	valid := len(modelFiles) > 0
	issues := make([]string, 0)
	if !valid {
		issues = append(issues, "No model weight files found in models/ directory")
	}

	return map[string]any{
		"run_id":        run.ID,
		"valid":         valid,
		"models_count":  len(modelFiles),
		"models":        modelFiles,
		"issues":        issues,
		"ready_publish": valid,
	}, nil
}

func (s *Server) handlePublishGenerateModelCard(ctx context.Context, in PublishGenerateModelCardIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	// Fetch workspace title
	var wsTitle string
	_ = s.store.Pool.QueryRow(ctx, `SELECT title FROM workspaces WHERE id=$1`, run.WorkspaceID).Scan(&wsTitle)

	// Fetch paper
	var paperTitle, arxivID string
	_ = s.store.Pool.QueryRow(ctx, `SELECT coalesce(title, ''), coalesce(arxiv_id, '') FROM papers WHERE workspace_id=$1 LIMIT 1`, run.WorkspaceID).Scan(&paperTitle, &arxivID)

	// Fetch metrics
	rows, _ := s.store.Pool.Query(ctx, `SELECT name, value FROM metrics WHERE run_id=$1`, run.ID)
	defer func() {
		if rows != nil {
			rows.Close()
		}
	}()

	var cardMetrics []hfpublish.CardMetric
	for rows != nil && rows.Next() {
		var name string
		var val float64
		if rows.Scan(&name, &val) == nil {
			cardMetrics = append(cardMetrics, hfpublish.CardMetric{Name: name, Value: val})
		}
	}

	// Fetch claims
	cRows, _ := s.store.Pool.Query(ctx, `
		SELECT c.metric_name, c.claim_text, coalesce(c.reported_value, '0'), c.page_number
		FROM claims c
		JOIN papers p ON p.id = c.paper_id
		WHERE p.workspace_id = $1`, run.WorkspaceID)
	defer func() {
		if cRows != nil {
			cRows.Close()
		}
	}()

	var cardClaims []hfpublish.CardClaim
	for cRows != nil && cRows.Next() {
		var mName, cText, rVal string
		var page int
		if cRows.Scan(&mName, &cText, &rVal, &page) == nil {
			var val float64
			_, _ = fmt.Sscanf(rVal, "%f", &val)
			cardClaims = append(cardClaims, hfpublish.CardClaim{
				MetricName:  mName,
				Description: cText,
				Value:       val,
				Page:        &page,
			})
		}
	}

	cardInfo := hfpublish.CardInfo{
		RepoID:     in.RepoID,
		Title:      wsTitle,
		RunID:      run.ID,
		Metrics:    cardMetrics,
		Claims:     cardClaims,
		FinishedAt: run.FinishedAt,
	}
	if paperTitle != "" || arxivID != "" {
		cardInfo.Papers = []hfpublish.CardPaper{{Title: paperTitle, ArxivID: arxivID}}
	}

	cardText := hfpublish.BuildModelCard(cardInfo)

	return map[string]any{
		"run_id":     run.ID,
		"model_card": cardText,
	}, nil
}

func (s *Server) handlePublishToHuggingFace(ctx context.Context, in PublishToHuggingFaceIn) (any, error) {
	if !in.Approved {
		return map[string]any{
			"requires_approval": true,
			"action_type":       "publish_huggingface",
			"description":       fmt.Sprintf("Publish model artifacts from Run %d to Hugging Face repository %q", in.RunID, in.RepoName),
			"payload": map[string]any{
				"run_id":    in.RunID,
				"repo_name": in.RepoName,
				"private":   in.Private,
			},
			"status":  "waiting_approval",
			"message": "Publishing to external services requires explicit confirmation. Please review and approve.",
		}, nil
	}

	if s.store != nil {
		if _, err := s.store.RunByID(ctx, in.RunID); err != nil {
			return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
		}
	}

	if strings.TrimSpace(in.RepoName) == "" {
		return nil, errors.New("repo_name cannot be empty")
	}

	// Queue publication record
	var pubID int64
	err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO hf_publications (run_id, user_id, repo_name, private, status, stage)
		VALUES ($1, $2, $3, $4, 'queued', 'queued')
		RETURNING id`, in.RunID, s.user.ID, in.RepoName, in.Private).Scan(&pubID)
	if err != nil {
		return nil, fmt.Errorf("queueing publication: %w", err)
	}

	if s.bus != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   in.RunID,
			Agent:   "huggingface",
			Type:    "hf_publish_queued",
			Message: fmt.Sprintf("Publishing to Hugging Face: %s", in.RepoName),
			Why:     "Researcher confirmed publication via MCP tool",
			Links:   mustJSON(map[string]any{"publication_id": pubID, "repo_name": in.RepoName}),
		})
	}

	return map[string]any{
		"publication_id": pubID,
		"run_id":         in.RunID,
		"repo_name":      in.RepoName,
		"status":         "queued",
		"message":        "Hugging Face publication queued successfully",
	}, nil
}

func (s *Server) handlePublishToGitHub(ctx context.Context, in PublishToGitHubIn) (any, error) {
	if !in.Approved {
		return map[string]any{
			"requires_approval": true,
			"action_type":       "publish_github",
			"description":       fmt.Sprintf("Push verified code and reproduction results for Run %d to GitHub repository", in.RunID),
			"payload": map[string]any{
				"run_id":    in.RunID,
				"repo_name": in.RepoName,
			},
			"status":  "waiting_approval",
			"message": "Pushing code to GitHub requires explicit confirmation. Please review and approve.",
		}, nil
	}

	if s.store != nil {
		if _, err := s.store.RunByID(ctx, in.RunID); err != nil {
			return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
		}
	}

	// Record push in pushes table
	var pushID int64
	err := s.store.Pool.QueryRow(ctx, `
		INSERT INTO pushes (run_id, user_id, repo, status, stage)
		VALUES ($1, $2, $3, 'queued', 'queued')
		RETURNING id`, in.RunID, s.user.ID, in.RepoName).Scan(&pushID)
	if err != nil {
		return nil, fmt.Errorf("queueing GitHub push: %w", err)
	}

	if s.bus != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   in.RunID,
			Agent:   "github",
			Type:    "github_push_queued",
			Message: fmt.Sprintf("GitHub push queued: %s", in.RepoName),
			Why:     "Researcher confirmed GitHub push via MCP tool",
			Links:   mustJSON(map[string]any{"push_id": pushID, "repo": in.RepoName}),
		})
	}

	return map[string]any{
		"push_id":   pushID,
		"run_id":    in.RunID,
		"repo_name": in.RepoName,
		"status":    "queued",
		"message":   "GitHub push queued successfully",
	}, nil
}
