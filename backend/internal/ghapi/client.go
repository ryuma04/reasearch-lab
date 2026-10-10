// Package ghapi is a minimal GitHub REST client (OAuth, users, repositories, git data).
package ghapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const apiBase = "https://api.github.com"

var httpClient = &http.Client{Timeout: 30 * time.Second}

type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("github %d: %s", e.Status, e.Message) }

// Client calls the GitHub API with a user's OAuth token.
type Client struct{ Token string }

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, apiBase+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return send(req, out)
}

func send(req *http.Request, out any) error {
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Message == "" {
			e.Message = strings.TrimSpace(string(data))
		}
		return &APIError{Status: resp.StatusCode, Message: e.Message}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// ---------- OAuth ----------

func AuthorizeURL(clientID, redirectURI, state string, scopes []string) string {
	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", strings.Join(scopes, " "))
	q.Set("state", state)
	q.Set("allow_signup", "true")
	return "https://github.com/login/oauth/authorize?" + q.Encode()
}

type TokenResponse struct {
	AccessToken string `json:"access_token"`
	Scope       string `json:"scope"`
	TokenType   string `json:"token_type"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

func ExchangeCode(ctx context.Context, clientID, clientSecret, code, redirectURI string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tr TokenResponse
	if err := send(req, &tr); err != nil {
		return nil, err
	}
	if tr.Error != "" {
		return nil, fmt.Errorf("github oauth: %s: %s", tr.Error, tr.ErrorDesc)
	}
	return &tr, nil
}

// RevokeGrant cancels our app's access on GitHub's side (DELETE /applications/{client_id}/grant).
func RevokeGrant(ctx context.Context, clientID, clientSecret, token string) error {
	b, _ := json.Marshal(map[string]string{"access_token": token})
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		apiBase+"/applications/"+url.PathEscape(clientID)+"/grant", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.SetBasicAuth(clientID, clientSecret)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	return send(req, nil)
}

// ---------- Users and repositories ----------

type GHUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

func (c *Client) User(ctx context.Context) (*GHUser, error) {
	var u GHUser
	return &u, c.do(ctx, http.MethodGet, "/user", nil, &u)
}

func (c *Client) PrimaryEmail(ctx context.Context) (string, error) {
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := c.do(ctx, http.MethodGet, "/user/emails", nil, &emails); err != nil {
		return "", err
	}
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	return "", nil
}

type Repo struct {
	ID            int64     `json:"id"`
	FullName      string    `json:"full_name"`
	Name          string    `json:"name"`
	Private       bool      `json:"private"`
	HTMLURL       string    `json:"html_url"`
	DefaultBranch string    `json:"default_branch"`
	UpdatedAt     time.Time `json:"updated_at"`
	Permissions   struct {
		Push bool `json:"push"`
	} `json:"permissions"`
}

func (c *Client) ListRepos(ctx context.Context) ([]Repo, error) {
	var repos []Repo
	err := c.do(ctx, http.MethodGet, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", nil, &repos)
	return repos, err
}

func (c *Client) GetRepo(ctx context.Context, fullName string) (*Repo, error) {
	var r Repo
	return &r, c.do(ctx, http.MethodGet, "/repos/"+fullName, nil, &r)
}

func (c *Client) CreateRepo(ctx context.Context, name, description string, private bool) (*Repo, error) {
	var r Repo
	err := c.do(ctx, http.MethodPost, "/user/repos", map[string]any{
		"name": name, "description": description, "private": private, "auto_init": true,
	}, &r)
	return &r, err
}
