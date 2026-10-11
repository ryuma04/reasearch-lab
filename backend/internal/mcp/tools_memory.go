package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type MemorySearchIn struct {
	Query string `json:"query"`
	Kind  string `json:"kind,omitempty" jsonschema:"error_fix | setting | experiment | agent_skill | paper_recipe"`
	Limit int    `json:"limit,omitempty" jsonschema:"max records to return, defaults to 10"`
}

type MemoryGetRecordIn struct {
	ID int64 `json:"id"`
}

type MemoryStoreIn struct {
	RunID   *int64         `json:"run_id,omitempty"`
	Kind    string         `json:"kind" jsonschema:"error_fix | setting | experiment | agent_skill | paper_recipe"`
	Title   string         `json:"title" jsonschema:"the lesson, in one sentence (stored as the memory text)"`
	Content map[string]any `json:"content,omitempty" jsonschema:"optional structured details"`
}

func (s *Server) handleMemorySearch(ctx context.Context, in MemorySearchIn) (any, error) {
	q := strings.TrimSpace(in.Query)
	limit := in.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	query := `
		SELECT id, kind, text, details, source_run_id, created_at
		FROM memory_items
		WHERE 1=1`
	args := []any{}
	idx := 1

	if in.Kind != "" {
		query += fmt.Sprintf(" AND kind = $%d", idx)
		args = append(args, in.Kind)
		idx++
	}
	if q != "" {
		query += fmt.Sprintf(" AND (lower(text) LIKE '%%' || lower($%d) || '%%' OR lower(details::text) LIKE '%%' || lower($%d) || '%%')", idx, idx)
		args = append(args, q)
		idx++
	}

	query += fmt.Sprintf(" ORDER BY success_rate DESC, id DESC LIMIT $%d", idx)
	args = append(args, limit)

	rows, err := s.store.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("memory search failed: %w", err)
	}
	defer rows.Close()

	type MemoryItem struct {
		ID        int64           `json:"id"`
		Kind      string          `json:"kind"`
		Title     string          `json:"text"`
		Content   json.RawMessage `json:"details"`
		RunID     *int64          `json:"source_run_id"`
		CreatedAt any             `json:"created_at"`
	}

	items := make([]MemoryItem, 0)
	for rows.Next() {
		var it MemoryItem
		if err := rows.Scan(&it.ID, &it.Kind, &it.Title, &it.Content, &it.RunID, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("memory search failed: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("memory search failed: %w", err)
	}

	return map[string]any{
		"query":   q,
		"kind":    in.Kind,
		"records": items,
		"count":   len(items),
	}, nil
}

func (s *Server) handleMemoryGetRecord(ctx context.Context, in MemoryGetRecordIn) (any, error) {
	var id int64
	var kind, title string
	var content json.RawMessage
	var runID *int64
	var createdAt any

	err := s.store.Pool.QueryRow(ctx, `
		SELECT id, kind, text, details, source_run_id, created_at
		FROM memory_items
		WHERE id = $1`, in.ID).Scan(&id, &kind, &title, &content, &runID, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("memory record %d not found: %w", in.ID, err)
	}

	return map[string]any{
		"id":         id,
		"kind":       kind,
		"text":          title,
		"details":       content,
		"source_run_id": runID,
		"created_at": createdAt,
	}, nil
}

func (s *Server) handleMemoryStore(ctx context.Context, in MemoryStoreIn) (any, error) {
	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		kind = "experiment"
	}
	validKinds := map[string]bool{
		"error_fix": true, "setting": true, "experiment": true, "agent_skill": true, "paper_recipe": true,
	}
	if !validKinds[kind] {
		return nil, errors.New("kind must be error_fix, setting, experiment, agent_skill, or paper_recipe")
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = "Research memory note"
	}

	contentBytes, err := json.Marshal(in.Content)
	if err != nil {
		return nil, fmt.Errorf("invalid content: %w", err)
	}

	var newID int64
	err = s.store.Pool.QueryRow(ctx, `
		INSERT INTO memory_items (kind, text, details, source_run_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id`, kind, title, contentBytes, in.RunID).Scan(&newID)
	if err != nil {
		return nil, fmt.Errorf("failed saving to memory: %w", err)
	}

	if in.RunID != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   *in.RunID,
			Agent:   "memory",
			Type:    "memory_learned",
			Message: fmt.Sprintf("Recorded %s to Lab Memory: %s", kind, title),
			Why:     "MCP tool memory_store",
			Links:   mustJSON(map[string]any{"memory_id": newID, "kind": kind}),
		})
	}

	return map[string]any{
		"id":      newID,
		"kind":    kind,
		"title":   title,
		"status":  "saved",
		"message": "Item stored in Lab Memory",
	}, nil
}
