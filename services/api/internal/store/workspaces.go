package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Workspace struct {
	ID            int64     `json:"id"`
	OwnerID       int64     `json:"owner_id"`
	Title         string    `json:"title"`
	ComputeBudget string    `json:"compute_budget"`
	Mode          string    `json:"mode"`
	Note          string    `json:"note"`
	CreatedAt     time.Time `json:"created_at"`
	Role          string    `json:"role,omitempty"` // role of the requesting user
}

const wsCols = `w.id, w.owner_id, w.title, w.compute_budget, w.mode, w.note, w.created_at`

func scanWS(row interface{ Scan(...any) error }, extra ...any) (*Workspace, error) {
	w := &Workspace{}
	dest := append([]any{&w.ID, &w.OwnerID, &w.Title, &w.ComputeBudget, &w.Mode, &w.Note, &w.CreatedAt}, extra...)
	return w, notFound(row.Scan(dest...))
}

// CreateWorkspace inserts the workspace and its owner membership in one transaction.
func (s *Store) CreateWorkspace(ctx context.Context, ownerID int64, title, budget, mode, note string) (*Workspace, error) {
	var ws *Workspace
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var err error
		ws, err = scanWS(tx.QueryRow(ctx, `
			INSERT INTO workspaces AS w (owner_id, title, compute_budget, mode, note)
			VALUES ($1, $2, $3, $4, $5) RETURNING `+wsCols, ownerID, title, budget, mode, note))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, ws.ID, ownerID)
		return err
	})
	if err != nil {
		return nil, err
	}
	ws.Role = "owner"
	return ws, nil
}

func (s *Store) WorkspaceByID(ctx context.Context, id int64) (*Workspace, error) {
	return scanWS(s.Pool.QueryRow(ctx, `SELECT `+wsCols+` FROM workspaces w WHERE w.id=$1`, id))
}

// WorkspaceForUser returns the workspace plus the user's role, or ErrNotFound if not a member.
func (s *Store) WorkspaceForUser(ctx context.Context, id, userID int64) (*Workspace, error) {
	w := &Workspace{}
	ws, err := scanWS(s.Pool.QueryRow(ctx, `
		SELECT `+wsCols+`, m.role FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $2
		WHERE w.id=$1`, id, userID), &w.Role)
	if err != nil {
		return nil, err
	}
	ws.Role = w.Role
	return ws, nil
}

func (s *Store) WorkspacesForUser(ctx context.Context, userID int64) ([]*Workspace, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT `+wsCols+`, m.role FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
		ORDER BY w.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Workspace{}
	for rows.Next() {
		var role string
		ws, err := scanWS(rows, &role)
		if err != nil {
			return nil, err
		}
		ws.Role = role
		out = append(out, ws)
	}
	return out, rows.Err()
}

func (s *Store) UpdateWorkspace(ctx context.Context, id int64, title, budget, note *string) (*Workspace, error) {
	return scanWS(s.Pool.QueryRow(ctx, `
		UPDATE workspaces w SET
			title = COALESCE($2, title),
			compute_budget = COALESCE($3, compute_budget),
			note = COALESCE($4, note)
		WHERE w.id=$1 RETURNING `+wsCols, id, title, budget, note))
}

type Upload struct {
	ID           int64     `json:"id"`
	WorkspaceID  int64     `json:"workspace_id"`
	Kind         string    `json:"kind"`
	PathOrURL    string    `json:"path_or_url"`
	OriginalName string    `json:"original_name"`
	SizeBytes    int64     `json:"size_bytes"`
	CreatedAt    time.Time `json:"created_at"`
}

func (s *Store) CreateUpload(ctx context.Context, u *Upload) error {
	return s.Pool.QueryRow(ctx, `
		INSERT INTO uploads (workspace_id, kind, path_or_url, original_name, size_bytes)
		VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
		u.WorkspaceID, u.Kind, u.PathOrURL, u.OriginalName, u.SizeBytes).Scan(&u.ID, &u.CreatedAt)
}

func (s *Store) UploadsForWorkspace(ctx context.Context, wsID int64) ([]Upload, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, kind, path_or_url, original_name, size_bytes, created_at
		FROM uploads WHERE workspace_id=$1 ORDER BY id`, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Upload{}
	for rows.Next() {
		var u Upload
		if err := rows.Scan(&u.ID, &u.WorkspaceID, &u.Kind, &u.PathOrURL, &u.OriginalName, &u.SizeBytes, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) UploadByID(ctx context.Context, wsID, id int64) (*Upload, error) {
	u := &Upload{}
	err := s.Pool.QueryRow(ctx, `
		SELECT id, workspace_id, kind, path_or_url, original_name, size_bytes, created_at
		FROM uploads WHERE workspace_id=$1 AND id=$2`, wsID, id).
		Scan(&u.ID, &u.WorkspaceID, &u.Kind, &u.PathOrURL, &u.OriginalName, &u.SizeBytes, &u.CreatedAt)
	return u, notFound(err)
}

func (s *Store) DeleteUpload(ctx context.Context, wsID, id int64) error {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM uploads WHERE workspace_id=$1 AND id=$2`, wsID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) CountPapers(ctx context.Context, wsID int64) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM uploads WHERE workspace_id=$1 AND kind='paper'`, wsID).Scan(&n)
	return n, err
}

type Note struct {
	ID          int64     `json:"id"`
	WorkspaceID int64     `json:"workspace_id"`
	RunID       *int64    `json:"run_id,omitempty"`
	AuthorType  string    `json:"author_type"`
	Author      string    `json:"author"`
	Title       string    `json:"title"`
	Markdown    string    `json:"markdown"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (s *Store) NotesForWorkspace(ctx context.Context, wsID int64) ([]Note, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, run_id, author_type, author, title, markdown, updated_at
		FROM notes WHERE workspace_id=$1
		ORDER BY (author_type = 'user') DESC, updated_at DESC`, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.RunID, &n.AuthorType, &n.Author, &n.Title, &n.Markdown, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// UpsertResearcherNote keeps one editable Markdown note per workspace for the researchers.
func (s *Store) UpsertResearcherNote(ctx context.Context, wsID, userID int64, markdown string) (*Note, error) {
	n := &Note{}
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `SELECT id FROM notes WHERE workspace_id=$1 AND author_type='user' ORDER BY id LIMIT 1 FOR UPDATE`, wsID).Scan(&id)
		if err == pgx.ErrNoRows {
			return tx.QueryRow(ctx, `
				INSERT INTO notes (workspace_id, author_type, author, title, markdown)
				VALUES ($1, 'user', $2, 'Research notes', $3)
				RETURNING id, workspace_id, run_id, author_type, author, title, markdown, updated_at`,
				wsID, itoa(userID), markdown).
				Scan(&n.ID, &n.WorkspaceID, &n.RunID, &n.AuthorType, &n.Author, &n.Title, &n.Markdown, &n.UpdatedAt)
		}
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE notes SET markdown=$2, author=$3, updated_at=now() WHERE id=$1
			RETURNING id, workspace_id, run_id, author_type, author, title, markdown, updated_at`,
			id, markdown, itoa(userID)).
			Scan(&n.ID, &n.WorkspaceID, &n.RunID, &n.AuthorType, &n.Author, &n.Title, &n.Markdown, &n.UpdatedAt)
	})
	return n, err
}
