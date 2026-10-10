package store

import (
	"context"
	"errors"
	"time"
)

type User struct {
	ID             int64     `json:"id"`
	GitHubID       *int64    `json:"github_id,omitempty"`
	Name           string    `json:"name"`
	Email          string    `json:"email"`
	GitHubUsername string    `json:"github_username"`
	AvatarURL      string    `json:"avatar_url"`
	CreatedAt      time.Time `json:"created_at"`
}

const userCols = `id, github_id, name, email, github_username, avatar_url, created_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	u := &User{}
	err := row.Scan(&u.ID, &u.GitHubID, &u.Name, &u.Email, &u.GitHubUsername, &u.AvatarURL, &u.CreatedAt)
	return u, notFound(err)
}

func (s *Store) UserByID(ctx context.Context, id int64) (*User, error) {
	return scanUser(s.Pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
}

// UpsertGitHubUser creates or updates the user that logged in with GitHub.
func (s *Store) UpsertGitHubUser(ctx context.Context, githubID int64, name, email, username, avatar string) (*User, error) {
	return scanUser(s.Pool.QueryRow(ctx, `
		INSERT INTO users (github_id, name, email, github_username, avatar_url)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (github_id) DO UPDATE SET
			name = EXCLUDED.name, email = EXCLUDED.email,
			github_username = EXCLUDED.github_username, avatar_url = EXCLUDED.avatar_url
		RETURNING `+userCols, githubID, name, email, username, avatar))
}

// LocalUser returns (creating if needed) a user who signs in with email + name, without GitHub
// (used while GitHub OAuth is not set up). The email identifies the account; the name is updated.
func (s *Store) LocalUser(ctx context.Context, email, name string) (*User, error) {
	key := "local:" + email
	return scanUser(s.Pool.QueryRow(ctx, `
		WITH found AS (
			UPDATE users SET name=$2 WHERE github_id IS NULL AND github_username=$3 RETURNING `+userCols+`
		), created AS (
			INSERT INTO users (name, email, github_username)
			SELECT $2, $1, $3 WHERE NOT EXISTS (SELECT 1 FROM found) RETURNING `+userCols+`
		)
		SELECT * FROM found UNION ALL SELECT * FROM created`, email, name, key))
}

type GitHubConnection struct {
	UserID         int64     `json:"-"`
	EncryptedToken []byte    `json:"-"`
	Scopes         string    `json:"scopes"`
	DefaultRepo    string    `json:"default_repo"`
	Status         string    `json:"status"`
	ConnectedAt    time.Time `json:"connected_at"`
}

func (s *Store) GitHubConnection(ctx context.Context, userID int64) (*GitHubConnection, error) {
	c := &GitHubConnection{}
	err := s.Pool.QueryRow(ctx, `
		SELECT user_id, encrypted_token, scopes, default_repo, status, connected_at
		FROM github_connections WHERE user_id=$1`, userID).
		Scan(&c.UserID, &c.EncryptedToken, &c.Scopes, &c.DefaultRepo, &c.Status, &c.ConnectedAt)
	return c, notFound(err)
}

func (s *Store) SaveGitHubConnection(ctx context.Context, userID int64, encToken []byte, scopes string) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO github_connections (user_id, encrypted_token, scopes, status, connected_at)
		VALUES ($1, $2, $3, 'connected', now())
		ON CONFLICT (user_id) DO UPDATE SET
			encrypted_token = EXCLUDED.encrypted_token, scopes = EXCLUDED.scopes,
			status = 'connected', connected_at = now()`, userID, encToken, scopes)
	return err
}

func (s *Store) SetDefaultRepo(ctx context.Context, userID int64, repo string) error {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE github_connections SET default_repo=$2 WHERE user_id=$1 AND status='connected'`, userID, repo)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DisconnectGitHub wipes the stored token; the row is kept so the UI can show "Not connected".
func (s *Store) DisconnectGitHub(ctx context.Context, userID int64) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE github_connections SET encrypted_token=NULL, status='disconnected', scopes=''
		WHERE user_id=$1`, userID)
	return err
}

type PushSummary struct {
	ID        int64     `json:"id"`
	RunID     int64     `json:"run_id"`
	RepoURL   string    `json:"repo_url"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) PushesByUser(ctx context.Context, userID int64) ([]PushSummary, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, run_id, repo_url, status, created_at FROM pushes
		WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PushSummary{}
	for rows.Next() {
		var p PushSummary
		if err := rows.Scan(&p.ID, &p.RunID, &p.RepoURL, &p.Status, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ErrEmailTaken means an email + password account already exists for that email.
var ErrEmailTaken = errors.New("email already registered")

// CreatePasswordUser registers an email + password account (password is already hashed).
func (s *Store) CreatePasswordUser(ctx context.Context, email, name, passwordHash string) (*User, error) {
	u, err := scanUser(s.Pool.QueryRow(ctx, `
		INSERT INTO users (name, email, github_username, password_hash) VALUES ($1, $2, '', $3)
		ON CONFLICT DO NOTHING RETURNING `+userCols, name, email, passwordHash))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrEmailTaken
	}
	return u, err
}

// PasswordUser returns the email + password account and its stored hash.
func (s *Store) PasswordUser(ctx context.Context, email string) (*User, string, error) {
	var hash string
	u := &User{}
	err := s.Pool.QueryRow(ctx, `SELECT `+userCols+`, password_hash FROM users
		WHERE github_id IS NULL AND password_hash <> '' AND lower(email) = lower($1)`, email).
		Scan(&u.ID, &u.GitHubID, &u.Name, &u.Email, &u.GitHubUsername, &u.AvatarURL, &u.CreatedAt, &hash)
	return u, hash, notFound(err)
}
