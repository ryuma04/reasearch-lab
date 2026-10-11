package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type PaperUploadIn struct {
	WorkspaceID *int64 `json:"workspace_id,omitempty" jsonschema:"optional; workspace ID to attach paper to (creates new if omitted)"`
	FilePath    string `json:"file_path,omitempty" jsonschema:"optional; path to PDF on local disk (e.g. C:\\Users\\...\\paper.pdf)"`
	ArxivOrURL  string `json:"arxiv_or_url,omitempty" jsonschema:"optional; arXiv link or URL (e.g. https://arxiv.org/abs/1706.03762)"`
	Title       string `json:"title,omitempty" jsonschema:"optional; paper title"`
}

type PaperContentIn struct {
	RunID   int64  `json:"run_id"`
	PaperID *int64 `json:"paper_id,omitempty" jsonschema:"optional; specific paper ID if multiple"`
}

type PaperPagesIn struct {
	RunID     int64 `json:"run_id"`
	StartPage int   `json:"start_page" jsonschema:"1-based start page"`
	EndPage   int   `json:"end_page" jsonschema:"1-based end page"`
}

type PaperClaimsIn struct {
	RunID int64 `json:"run_id"`
}

type PaperCitationsIn struct {
	RunID int64 `json:"run_id"`
}

// paperForRun resolves the primary paper for a run from uploads or papers table.
func (s *Server) paperForRun(ctx context.Context, runID int64, requestedPaperID *int64) (*store.Run, map[string]any, error) {
	run, err := s.store.RunByID(ctx, runID)
	if err != nil {
		return nil, nil, fmt.Errorf("run %d not found: %w", runID, err)
	}

	query := `
		SELECT p.id, p.workspace_id, p.upload_id, coalesce(p.title, ''), coalesce(p.arxiv_id, ''),
		       coalesce(p.pdf_path, ''), coalesce(p.parsed_markdown_path, ''), u.original_name
		FROM papers p
		JOIN uploads u ON u.id = p.upload_id
		WHERE p.workspace_id = $1`
	args := []any{run.WorkspaceID}
	if requestedPaperID != nil && *requestedPaperID > 0 {
		query += " AND p.id = $2"
		args = append(args, *requestedPaperID)
	} else {
		query += " ORDER BY p.id ASC LIMIT 1"
	}

	var pID, wsID, upID int64
	var title, arxivID, pdfPath, mdPath, origName string
	err = s.store.Pool.QueryRow(ctx, query, args...).Scan(&pID, &wsID, &upID, &title, &arxivID, &pdfPath, &mdPath, &origName)
	if err != nil {
		return run, map[string]any{"workspace_id": run.WorkspaceID, "run_id": run.ID}, nil
	}

	paper := map[string]any{
		"id":                   pID,
		"workspace_id":         wsID,
		"upload_id":            upID,
		"title":                title,
		"arxiv_id":             arxivID,
		"pdf_path":             pdfPath,
		"parsed_markdown_path": mdPath,
		"original_name":        origName,
	}
	return run, paper, nil
}

func (s *Server) handlePaperGetContent(ctx context.Context, in PaperContentIn) (any, error) {
	run, paper, err := s.paperForRun(ctx, in.RunID, in.PaperID)
	if err != nil {
		return nil, err
	}
	if paper == nil || paper["id"] == nil {
		return map[string]any{"run_id": in.RunID, "message": "No paper uploaded for this workspace yet"}, nil
	}

	mdPath, _ := paper["parsed_markdown_path"].(string)
	var content string
	if mdPath != "" {
		fullPath := filepath.Join(s.cfg.DataDir, mdPath)
		if data, err := os.ReadFile(fullPath); err == nil {
			content = string(data)
		}
	}

	// Fallback to brief.md if parsed markdown is not found
	if content == "" {
		briefPath := filepath.Join(s.cfg.DataDir, fmt.Sprintf("runs/%d/research/brief.md", in.RunID))
		if data, err := os.ReadFile(briefPath); err == nil {
			content = string(data)
		}
	}

	// If content is very long, cap to first 24KB for LLM token budget
	truncated := false
	if len(content) > 24576 {
		content = content[:24576]
		truncated = true
	}

	return map[string]any{
		"run_id":         run.ID,
		"workspace_id":   run.WorkspaceID,
		"paper_id":       paper["id"],
		"title":          paper["title"],
		"arxiv_id":       paper["arxiv_id"],
		"content":        content,
		"content_length": len(content),
		"truncated":      truncated,
	}, nil
}

var pageSplitRe = regexp.MustCompile(`<!--\s*page\s*(\d+)\s*-->|\[page\s*(\d+)\]`)

func (s *Server) handlePaperGetPages(ctx context.Context, in PaperPagesIn) (any, error) {
	if in.StartPage < 1 {
		in.StartPage = 1
	}
	if in.EndPage < in.StartPage {
		in.EndPage = in.StartPage
	}
	// Limit page range to 10 pages per call
	if in.EndPage-in.StartPage > 10 {
		in.EndPage = in.StartPage + 10
	}

	run, paper, err := s.paperForRun(ctx, in.RunID, nil)
	if err != nil {
		return nil, err
	}
	if paper == nil || paper["id"] == nil {
		return nil, errors.New("paper not found for run")
	}

	mdPath, _ := paper["parsed_markdown_path"].(string)
	if mdPath == "" {
		return nil, errors.New("parsed markdown not available for this paper")
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.DataDir, mdPath))
	if err != nil {
		return nil, fmt.Errorf("reading paper markdown: %w", err)
	}

	text := string(data)
	chunks := pageSplitRe.Split(text, -1)
	pages := make([]map[string]any, 0)

	// chunks[0] may be preamble before page 1
	for idx, chunk := range chunks {
		pageNum := idx
		if pageNum < in.StartPage || pageNum > in.EndPage {
			continue
		}
		cleanChunk := strings.TrimSpace(chunk)
		if cleanChunk != "" {
			pages = append(pages, map[string]any{
				"page_number": pageNum,
				"content":     cleanChunk,
				"char_count":  len(cleanChunk),
			})
		}
	}

	return map[string]any{
		"run_id":      run.ID,
		"paper_title": paper["title"],
		"start_page":  in.StartPage,
		"end_page":    in.EndPage,
		"pages":       pages,
		"total_pages": len(chunks) - 1,
	}, nil
}

func (s *Server) handlePaperGetClaims(ctx context.Context, in PaperClaimsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	type ClaimItem struct {
		ID          int64   `json:"id"`
		PaperID     int64   `json:"paper_id"`
		MetricName  string  `json:"metric_name"`
		Description string  `json:"description"`
		Value       float64 `json:"value"`
		Unit        string  `json:"unit"`
		Page        int     `json:"page"`
		Quote       string  `json:"quote"`
	}

	claims := make([]ClaimItem, 0)
	rows, err := s.store.Pool.Query(ctx, `
		SELECT c.id, c.paper_id, coalesce(c.metric_name, ''), coalesce(c.description, ''),
		       coalesce(c.value, 0), coalesce(c.unit, ''), coalesce(c.page, 1), coalesce(c.quote, '')
		FROM claims c
		JOIN papers p ON p.id = c.paper_id
		WHERE p.workspace_id = $1
		ORDER BY c.page ASC, c.id ASC`, run.WorkspaceID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var item ClaimItem
			if err := rows.Scan(&item.ID, &item.PaperID, &item.MetricName, &item.Description, &item.Value, &item.Unit, &item.Page, &item.Quote); err == nil {
				claims = append(claims, item)
			}
		}
	}

	// Check if research/brief.json has structured claims
	briefJSONPath := filepath.Join(s.cfg.DataDir, fmt.Sprintf("runs/%d/research/brief.json", in.RunID))
	var briefData map[string]any
	if data, err := os.ReadFile(briefJSONPath); err == nil {
		_ = json.Unmarshal(data, &briefData)
	}

	return map[string]any{
		"run_id":        run.ID,
		"workspace_id":  run.WorkspaceID,
		"claims":        claims,
		"count":         len(claims),
		"brief":         briefData,
		"brief_summary": briefData["summary"],
		"methodology":   briefData["methodology"],
	}, nil
}

func (s *Server) handlePaperGetCitations(ctx context.Context, in PaperCitationsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	rows, err := s.store.Pool.Query(ctx, `
		SELECT id, kind, original_name, path_or_url, created_at
		FROM uploads
		WHERE workspace_id = $1
		ORDER BY id ASC`, run.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	uploads := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var kind, origName, pathURL string
		var created any
		if err := rows.Scan(&id, &kind, &origName, &pathURL, &created); err == nil {
			uploads = append(uploads, map[string]any{
				"id":            id,
				"kind":          kind,
				"original_name": origName,
				"path_or_url":   pathURL,
				"created_at":    created,
			})
		}
	}

	return map[string]any{
		"run_id":       run.ID,
		"workspace_id": run.WorkspaceID,
		"sources":      uploads,
	}, nil
}
