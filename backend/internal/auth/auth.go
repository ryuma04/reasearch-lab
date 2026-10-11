// Package auth handles GitHub OAuth login, sessions, the profile and the GitHub connection.
package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/ghapi"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// SessionCookie is the name of the session cookie (also used by the CSRF middleware).
const SessionCookie = sessionCookie

const (
	sessionCookie = "lab_session"
	stateCookie   = "lab_oauth_state"
	sessionTTL    = 7 * 24 * time.Hour
)

// Scopes: read profile + email, create and write repositories.
var oauthScopes = []string{"read:user", "user:email", "repo"}

var ErrGitHubNotConnected = httpx.Errorf(http.StatusPreconditionRequired, "GitHub is not connected; connect GitHub first")

type Service struct {
	cfg   *config.Config
	store *store.Store
}

func New(cfg *config.Config, st *store.Store) *Service { return &Service{cfg: cfg, store: st} }

type ctxKey struct{}

func UserID(ctx context.Context) int64 {
	id, _ := ctx.Value(ctxKey{}).(int64)
	return id
}

func WithUserID(ctx context.Context, id int64) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// Middleware reads the session from the cookie or an "Authorization: Bearer" header.
// It never rejects; use Require for protected routes.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if c, err := r.Cookie(sessionCookie); err == nil {
			token = c.Value
		}
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
		if token != "" {
			if uid, err := verifySession(s.cfg.SessionSecret, token); err == nil {
				r = r.WithContext(WithUserID(r.Context(), uid))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if UserID(r.Context()) == 0 {
			httpx.Fail(w, r, httpx.ErrUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireInternal protects /internal/* endpoints used by the agent worker and n8n.
func (s *Service) RequireInternal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("X-Internal-Token")
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(s.cfg.InternalToken)) != 1 {
			httpx.Fail(w, r, httpx.ErrForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Service) callbackURL() string { return s.cfg.PublicAPIURL + "/auth/github/callback" }

func (s *Service) cookieSettings() (bool, http.SameSite) {
	// For cross-site deployments (e.g. Vercel frontend + Render backend on https),
	// browsers require SameSite=None and Secure=true for cross-origin fetch() with credentials.
	isHTTPS := strings.HasPrefix(s.cfg.PublicAPIURL, "https") ||
		strings.HasPrefix(s.cfg.FrontendURL, "https") ||
		s.cfg.Env == "production"
	if isHTTPS {
		return true, http.SameSiteNoneMode
	}
	return false, http.SameSiteLaxMode
}

func (s *Service) setSession(w http.ResponseWriter, userID int64) (string, error) {
	token, err := signSession(s.cfg.SessionSecret, userID, sessionTTL)
	if err != nil {
		return "", err
	}
	secure, sameSite := s.cookieSettings()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: secure, SameSite: sameSite,
		MaxAge: int(sessionTTL.Seconds()),
	})
	return token, nil
}

// POST /auth/mcp-token: a bearer token for the logged-in user, for MCP clients such as the Gemini CLI
// (Authorization: Bearer <token> on /mcp). It acts exactly as this user, with the same workspace permissions,
// and expires with the normal session lifetime. The session cookie itself is HttpOnly and stays unreadable.
func (s *Service) MCPToken(w http.ResponseWriter, r *http.Request) error {
	uid := UserID(r.Context())
	if uid == 0 {
		return httpx.ErrUnauthorized
	}
	token, err := signSession(s.cfg.SessionSecret, uid, sessionTTL)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"token": token, "expires_at": time.Now().Add(sessionTTL).UTC().Format(time.RFC3339),
		"mcp_url": strings.TrimRight(s.cfg.PublicAPIURL, "/") + "/mcp",
	})
	return nil
}

// safeRedirect only allows redirects back to our own frontend.
func (s *Service) safeRedirect(target string) string {
	if target != "" && strings.HasPrefix(target, s.cfg.FrontendURL+"/") {
		return target
	}
	return s.cfg.FrontendURL + "/profile"
}

// SafeReturnPath accepts only a relative in-app path ("/workspaces/7"), never "//host" or a URL.
func SafeReturnPath(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") ||
		strings.ContainsAny(p, "\r\n") {
		return "/dashboard"
	}
	return p
}

// loginTarget is where the browser lands after GitHub login. With ?return_to=/path it is the
// frontend's /auth/callback page (which confirms the session, then opens the path).
func (s *Service) loginTarget(r *http.Request) string {
	if rt := r.URL.Query().Get("return_to"); rt != "" {
		return s.cfg.FrontendURL + "/auth/callback?return_to=" + url.QueryEscape(SafeReturnPath(rt))
	}
	return s.safeRedirect(r.URL.Query().Get("redirect"))
}

// GET /auth/github/login[?return_to=/path | ?redirect=<frontend url>]
func (s *Service) Login(w http.ResponseWriter, r *http.Request) error {
	if !s.cfg.GitHubConfigured() {
		return httpx.Errorf(http.StatusServiceUnavailable, "GitHub OAuth is not configured (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)")
	}
	state := RandomToken(24)
	secure, sameSite := s.cookieSettings()
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state + "|" + s.loginTarget(r),
		Path: "/auth/github", HttpOnly: true, SameSite: sameSite, MaxAge: 600,
		Secure: secure,
	})
	http.Redirect(w, r, ghapi.AuthorizeURL(s.cfg.GitHubClientID, s.callbackURL(), state, oauthScopes), http.StatusFound)
	return nil
}

// GET /auth/github/callback?code=..&state=..
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) error {
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, "login session expired, try again")
	}
	state, redirect, _ := strings.Cut(c.Value, "|")
	if state == "" || r.URL.Query().Get("state") != state {
		return httpx.Errorf(http.StatusBadRequest, "invalid OAuth state")
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/auth/github", MaxAge: -1})
	if e := r.URL.Query().Get("error"); e != "" {
		reason := "error"
		if e == "access_denied" {
			reason = "cancelled"
		}
		http.Redirect(w, r, s.cfg.FrontendURL+"/login?reason="+reason, http.StatusFound)
		return nil
	}

	ctx := r.Context()
	tr, err := ghapi.ExchangeCode(ctx, s.cfg.GitHubClientID, s.cfg.GitHubClientSecret, r.URL.Query().Get("code"), s.callbackURL())
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "could not complete GitHub login")
	}
	gh := &ghapi.Client{Token: tr.AccessToken}
	ghUser, err := gh.User(ctx)
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "could not read GitHub profile")
	}
	email := ghUser.Email
	if email == "" {
		email, _ = gh.PrimaryEmail(ctx)
	}
	name := ghUser.Name
	if name == "" {
		name = ghUser.Login
	}
	user, err := s.store.UpsertGitHubUser(ctx, ghUser.ID, name, email, ghUser.Login, ghUser.AvatarURL)
	if err != nil {
		return err
	}
	enc, err := Encrypt(s.cfg.TokenKey, tr.AccessToken)
	if err != nil {
		return err
	}
	if err := s.store.SaveGitHubConnection(ctx, user.ID, enc, tr.Scope); err != nil {
		return err
	}
	token, err := s.setSession(w, user.ID)
	if err != nil {
		return err
	}
	slog.Info("user logged in with GitHub", "user_id", user.ID, "login", ghUser.Login)
	if strings.Contains(redirect, "/auth/callback?") {
		redirect = strings.Replace(redirect, "/auth/callback?", "/auth/callback?status=success&token="+url.QueryEscape(token)+"&", 1)
	}
	http.Redirect(w, r, redirect, http.StatusFound)
	return nil
}

// POST /auth/dev-login {"email": "you@example.com", "name": "Your Name"}
// Email + name sign-in without GitHub, only when DEV_LOGIN_ENABLED=true (until GitHub OAuth is
// configured). Sets the session cookie; also returns a bearer token for curl/testing.
// GitHub can still be connected later for pushes.
func (s *Service) DevLogin(w http.ResponseWriter, r *http.Request) error {
	if !s.cfg.DevLoginEnabled {
		return httpx.Errorf(http.StatusNotFound, "not found")
	}
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if r.ContentLength != 0 {
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if body.Email == "" {
		// curl convenience: {"name": "alice"} -> alice@localhost
		if body.Name == "" {
			body.Name = "researcher"
		}
		body.Email = strings.ToLower(strings.ReplaceAll(body.Name, " ", ".")) + "@localhost"
	}
	if !emailRe.MatchString(body.Email) {
		return httpx.Errorf(http.StatusBadRequest, "enter a valid email address")
	}
	if body.Name == "" {
		body.Name, _, _ = strings.Cut(body.Email, "@")
	}
	if len(body.Name) > 100 {
		return httpx.Errorf(http.StatusBadRequest, "name is too long")
	}
	user, err := s.store.LocalUser(r.Context(), body.Email, body.Name)
	if err != nil {
		return err
	}
	token, err := s.setSession(w, user.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user, "token": token})
	return nil
}

var emailRe = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]{1,190}$`)

// POST /auth/logout
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) error {
	secure, sameSite := s.cookieSettings()
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: sameSite})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type githubStatus struct {
	Connected       bool   `json:"connected"`
	Status          string `json:"status"` // connected | disconnected | never
	Scopes          string `json:"scopes"`
	DefaultRepo     string `json:"default_repo"`
	DefaultRepoURL  string `json:"default_repo_url,omitempty"`
	OAuthConfigured bool   `json:"oauth_configured"`
	LoginURL        string `json:"login_url"`
}

// GET /me — profile, GitHub connection status and pushed repositories.
func (s *Service) Me(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	uid := UserID(ctx)
	user, err := s.store.UserByID(ctx, uid)
	if err != nil {
		return err
	}
	st := githubStatus{Status: "never", OAuthConfigured: s.cfg.GitHubConfigured(), LoginURL: s.cfg.PublicAPIURL + "/auth/github/login"}
	if conn, err := s.store.GitHubConnection(ctx, uid); err == nil {
		st.Status = conn.Status
		st.Connected = conn.Status == "connected" && len(conn.EncryptedToken) > 0
		st.Scopes = conn.Scopes
		st.DefaultRepo = conn.DefaultRepo
		if conn.DefaultRepo != "" {
			st.DefaultRepoURL = "https://github.com/" + conn.DefaultRepo
		}
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	pushes, err := s.store.PushesByUser(ctx, uid)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user, "github": st, "pushes": pushes})
	return nil
}

// GitHubToken returns the decrypted token for server-side use only (never sent to the browser).
func (s *Service) GitHubToken(ctx context.Context, userID int64) (string, error) {
	conn, err := s.store.GitHubConnection(ctx, userID)
	if errors.Is(err, store.ErrNotFound) {
		return "", ErrGitHubNotConnected
	}
	if err != nil {
		return "", err
	}
	if conn.Status != "connected" || len(conn.EncryptedToken) == 0 {
		return "", ErrGitHubNotConnected
	}
	return Decrypt(s.cfg.TokenKey, conn.EncryptedToken)
}

func (s *Service) client(ctx context.Context) (*ghapi.Client, error) {
	tok, err := s.GitHubToken(ctx, UserID(ctx))
	if err != nil {
		return nil, err
	}
	return &ghapi.Client{Token: tok}, nil
}

func githubFail(err error) error {
	var ae *ghapi.APIError
	if errors.As(err, &ae) {
		if ae.Status == http.StatusUnauthorized {
			return httpx.Errorf(http.StatusPreconditionRequired, "GitHub access was revoked or expired; reconnect GitHub")
		}
		return httpx.Errorf(http.StatusBadGateway, "GitHub: "+ae.Message)
	}
	return err
}

// GET /github/repos
func (s *Service) ListRepos(w http.ResponseWriter, r *http.Request) error {
	gh, err := s.client(r.Context())
	if err != nil {
		return err
	}
	repos, err := gh.ListRepos(r.Context())
	if err != nil {
		return githubFail(err)
	}
	httpx.JSON(w, http.StatusOK, repos)
	return nil
}

var repoNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

// POST /github/repos {"name": "...", "description": "...", "private": true, "set_default": true}
func (s *Service) CreateRepo(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Private     *bool  `json:"private"`
		SetDefault  *bool  `json:"set_default"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if !repoNameRe.MatchString(body.Name) {
		return httpx.Errorf(http.StatusBadRequest, "invalid repository name")
	}
	private := body.Private == nil || *body.Private
	gh, err := s.client(r.Context())
	if err != nil {
		return err
	}
	repo, err := gh.CreateRepo(r.Context(), body.Name, body.Description, private)
	if err != nil {
		return githubFail(err)
	}
	if body.SetDefault == nil || *body.SetDefault {
		if err := s.store.SetDefaultRepo(r.Context(), UserID(r.Context()), repo.FullName); err != nil {
			return err
		}
	}
	httpx.JSON(w, http.StatusCreated, repo)
	return nil
}

// PUT /github/default-repo {"full_name": "owner/repo"}
func (s *Service) SetDefaultRepo(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		FullName string `json:"full_name"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	owner, name, ok := strings.Cut(body.FullName, "/")
	if !ok || owner == "" || !repoNameRe.MatchString(name) {
		return httpx.Errorf(http.StatusBadRequest, "full_name must look like owner/repo")
	}
	gh, err := s.client(r.Context())
	if err != nil {
		return err
	}
	repo, err := gh.GetRepo(r.Context(), body.FullName)
	if err != nil {
		return githubFail(err)
	}
	if !repo.Permissions.Push {
		return httpx.Errorf(http.StatusForbidden, "you do not have write access to "+repo.FullName)
	}
	if err := s.store.SetDefaultRepo(r.Context(), UserID(r.Context()), repo.FullName); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"default_repo": repo.FullName, "url": repo.HTMLURL})
	return nil
}

// DELETE /github/connection — revoke on GitHub's side, then wipe the token locally.
func (s *Service) Disconnect(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	uid := UserID(ctx)
	tok, err := s.GitHubToken(ctx, uid)
	if err != nil && !errors.Is(err, ErrGitHubNotConnected) {
		return err
	}
	revoked := false
	if tok != "" && s.cfg.GitHubConfigured() {
		if err := ghapi.RevokeGrant(ctx, s.cfg.GitHubClientID, s.cfg.GitHubClientSecret, tok); err != nil {
			// Still wipe locally: the user asked to disconnect.
			slog.Warn("github grant revoke failed", "user_id", uid, "err", err)
		} else {
			revoked = true
		}
	}
	if err := s.store.DisconnectGitHub(ctx, uid); err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "disconnected", "revoked_on_github": revoked})
	return nil
}

type passwordBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (b *passwordBody) clean() error {
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	b.Name = strings.TrimSpace(b.Name)
	if !emailRe.MatchString(b.Email) {
		return httpx.Errorf(http.StatusBadRequest, "enter a valid email address")
	}
	if err := validatePassword(b.Password); err != nil {
		return httpx.Errorf(http.StatusBadRequest, err.Error())
	}
	if len(b.Name) > 100 {
		return httpx.Errorf(http.StatusBadRequest, "name is too long")
	}
	return nil
}

// POST /auth/register {"email", "password", "name"} — email + password account (alongside GitHub).
// GitHub can still be connected later from the profile for pushes.
func (s *Service) Register(w http.ResponseWriter, r *http.Request) error {
	if !s.cfg.EmailLoginEnabled {
		return httpx.Errorf(http.StatusNotFound, "email sign-in is disabled")
	}
	var body passwordBody
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if err := body.clean(); err != nil {
		return err
	}
	if body.Name == "" {
		body.Name, _, _ = strings.Cut(body.Email, "@")
	}
	hash, err := HashPassword(body.Password)
	if err != nil {
		return err
	}
	user, err := s.store.CreatePasswordUser(r.Context(), body.Email, body.Name, hash)
	if errors.Is(err, store.ErrEmailTaken) {
		return httpx.Errorf(http.StatusConflict, "an account with this email already exists; sign in instead")
	}
	if err != nil {
		return err
	}
	token, err := s.setSession(w, user.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"user": user, "token": token})
	return nil
}

// POST /auth/login {"email", "password"}
func (s *Service) PasswordLogin(w http.ResponseWriter, r *http.Request) error {
	if !s.cfg.EmailLoginEnabled {
		return httpx.Errorf(http.StatusNotFound, "email sign-in is disabled")
	}
	var body passwordBody
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	invalid := httpx.Errorf(http.StatusUnauthorized, "wrong email or password")
	user, hash, err := s.store.PasswordUser(r.Context(), body.Email)
	if errors.Is(err, store.ErrNotFound) {
		CheckPassword(body.Password, dummyHash) // same work either way: no account-existence timing leak
		return invalid
	}
	if err != nil {
		return err
	}
	if !CheckPassword(body.Password, hash) {
		return invalid
	}
	token, err := s.setSession(w, user.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"user": user, "token": token})
	return nil
}

var dummyHash, _ = HashPassword("not-a-real-password")
