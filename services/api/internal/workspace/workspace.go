// Package workspace handles workspaces, uploads (papers, datasets, repo links, notes) and Markdown notes.
package workspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ryuma04/tapu-sena/services/api/internal/auth"
	"github.com/ryuma04/tapu-sena/services/api/internal/config"
	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
)

const (
	maxPaperBytes   = 50 << 20 // 50 MB per PDF
	maxDatasetBytes = 1 << 30  // 1 GB per dataset file
	maxNoteBytes    = 1 << 20
)

var roleRank = map[string]int{"viewer": 1, "editor": 2, "owner": 3}

type Service struct {
	cfg   *config.Config
	store *store.Store
}

func New(cfg *config.Config, st *store.Store) *Service { return &Service{cfg: cfg, store: st} }

// Access loads a workspace and checks the user has at least minRole in it.
// Non-members get 404 so workspace ids are not leaked.
func Access(ctx context.Context, st *store.Store, wsID int64, minRole string) (*store.Workspace, error) {
	ws, err := st.WorkspaceForUser(ctx, wsID, auth.UserID(ctx))
	if err != nil {
		return nil, err
	}
	if roleRank[ws.Role] < roleRank[minRole] {
		return nil, httpx.ErrForbidden
	}
	return ws, nil
}

func validBudget(b string) bool { return b == "quick" || b == "standard" || b == "deep" }

// POST /workspaces
// Accepts JSON {title, compute_budget, mode, note} or a multipart form that creates the
// workspace and its uploads in one request:
//
//	title, compute_budget, mode, note, repo_url, dataset_url, arxiv (repeatable),
//	papers (files, repeatable), dataset (file)
//
// The multipart form requires at least one paper (file or arXiv link).
func (s *Service) Create(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		return s.createMultipart(w, r)
	}
	var body struct {
		Title         string `json:"title"`
		ComputeBudget string `json:"compute_budget"`
		Mode          string `json:"mode"`
		Note          string `json:"note"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	ws, err := s.create(ctx, body.Title, body.ComputeBudget, body.Mode, body.Note)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"workspace": ws, "uploads": []store.Upload{}})
	return nil
}

func (s *Service) create(ctx context.Context, title, budget, mode, note string) (*store.Workspace, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Untitled research"
	}
	if budget == "" {
		budget = "quick"
	}
	if !validBudget(budget) {
		return nil, httpx.Errorf(http.StatusBadRequest, "compute_budget must be quick, standard or deep")
	}
	if mode == "" {
		mode = "reproduce"
	}
	if mode != "reproduce" && mode != "compare" {
		return nil, httpx.Errorf(http.StatusBadRequest, "mode must be reproduce or compare")
	}
	if len(note) > maxNoteBytes {
		return nil, httpx.Errorf(http.StatusBadRequest, "note is too long")
	}
	return s.store.CreateWorkspace(ctx, auth.UserID(ctx), title, budget, mode, note)
}

func (s *Service) createMultipart(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, maxDatasetBytes+10*maxPaperBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return httpx.Errorf(http.StatusBadRequest, "invalid upload form: "+err.Error())
	}
	defer r.MultipartForm.RemoveAll()
	f := r.MultipartForm

	paperFiles := f.File["papers"]
	arxivLinks := nonEmpty(f.Value["arxiv"])
	if len(paperFiles) == 0 && len(arxivLinks) == 0 {
		return httpx.Errorf(http.StatusBadRequest, "at least one research paper (PDF or arXiv link) is required")
	}
	// Validate links before creating anything.
	normalized := make([]string, 0, len(arxivLinks))
	for _, l := range arxivLinks {
		u, err := normalizeArxiv(l)
		if err != nil {
			return err
		}
		normalized = append(normalized, u)
	}
	repoURL := strings.TrimSpace(first(f.Value["repo_url"]))
	if repoURL != "" {
		if err := validateRepoURL(repoURL); err != nil {
			return err
		}
	}
	datasetURL := strings.TrimSpace(first(f.Value["dataset_url"]))
	if datasetURL != "" {
		if err := validateHTTPURL(datasetURL); err != nil {
			return err
		}
	}

	ws, err := s.create(ctx, first(f.Value["title"]), first(f.Value["compute_budget"]), first(f.Value["mode"]), first(f.Value["note"]))
	if err != nil {
		return err
	}
	uploads := []store.Upload{}
	add := func(u *store.Upload, err error) error {
		if err != nil {
			return err
		}
		uploads = append(uploads, *u)
		return nil
	}
	for _, fh := range paperFiles {
		if err := add(s.saveFile(ctx, ws.ID, "paper", fh)); err != nil {
			return err
		}
	}
	for _, u := range normalized {
		if err := add(s.saveLink(ctx, ws.ID, "paper", u)); err != nil {
			return err
		}
	}
	for _, fh := range f.File["dataset"] {
		if err := add(s.saveFile(ctx, ws.ID, "dataset", fh)); err != nil {
			return err
		}
	}
	if datasetURL != "" {
		if err := add(s.saveLink(ctx, ws.ID, "dataset", datasetURL)); err != nil {
			return err
		}
	}
	if repoURL != "" {
		if err := add(s.saveLink(ctx, ws.ID, "repo_link", repoURL)); err != nil {
			return err
		}
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"workspace": ws, "uploads": uploads})
	return nil
}

// GET /workspaces
func (s *Service) List(w http.ResponseWriter, r *http.Request) error {
	list, err := s.store.WorkspacesForUser(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, list)
	return nil
}

// GET /workspaces/{id}
func (s *Service) Get(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	ws, err := Access(r.Context(), s.store, id, "viewer")
	if err != nil {
		return err
	}
	uploads, err := s.store.UploadsForWorkspace(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"workspace": ws, "uploads": uploads})
	return nil
}

// PATCH /workspaces/{id} {title?, compute_budget?, note?}
func (s *Service) Update(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "editor"); err != nil {
		return err
	}
	var body struct {
		Title         *string `json:"title"`
		ComputeBudget *string `json:"compute_budget"`
		Note          *string `json:"note"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.ComputeBudget != nil && !validBudget(*body.ComputeBudget) {
		return httpx.Errorf(http.StatusBadRequest, "compute_budget must be quick, standard or deep")
	}
	ws, err := s.store.UpdateWorkspace(r.Context(), id, body.Title, body.ComputeBudget, body.Note)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, ws)
	return nil
}

// POST /workspaces/{id}/uploads
// multipart: kind=paper|dataset, file=<file>
// JSON: {"kind": "paper"|"dataset"|"repo_link"|"note", "url": "...", "text": "..."}
func (s *Service) CreateUpload(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := Access(ctx, s.store, id, "editor"); err != nil {
		return err
	}

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, maxDatasetBytes+(1<<20))
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			return httpx.Errorf(http.StatusBadRequest, "invalid upload form: "+err.Error())
		}
		defer r.MultipartForm.RemoveAll()
		kind := r.FormValue("kind")
		if kind != "paper" && kind != "dataset" {
			return httpx.Errorf(http.StatusBadRequest, "file uploads must have kind paper or dataset")
		}
		files := r.MultipartForm.File["file"]
		if len(files) != 1 {
			return httpx.Errorf(http.StatusBadRequest, "send exactly one file in the 'file' field")
		}
		u, err := s.saveFile(ctx, id, kind, files[0])
		if err != nil {
			return err
		}
		httpx.JSON(w, http.StatusCreated, u)
		return nil
	}

	var body struct {
		Kind string `json:"kind"`
		URL  string `json:"url"`
		Text string `json:"text"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	var u *store.Upload
	switch body.Kind {
	case "paper":
		link, err := normalizeArxiv(body.URL)
		if err != nil {
			return err
		}
		u, err = s.saveLink(ctx, id, "paper", link)
		if err != nil {
			return err
		}
	case "dataset":
		if err := validateHTTPURL(body.URL); err != nil {
			return err
		}
		u, err = s.saveLink(ctx, id, "dataset", strings.TrimSpace(body.URL))
	case "repo_link":
		if err := validateRepoURL(body.URL); err != nil {
			return err
		}
		u, err = s.saveLink(ctx, id, "repo_link", strings.TrimSpace(body.URL))
	case "note":
		text := strings.TrimSpace(body.Text)
		if text == "" || len(text) > maxNoteBytes {
			return httpx.Errorf(http.StatusBadRequest, "note text is required (max 1 MB)")
		}
		u, err = s.saveLink(ctx, id, "note", text)
	default:
		return httpx.Errorf(http.StatusBadRequest, "kind must be paper, dataset, repo_link or note")
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusCreated, u)
	return nil
}

// GET /workspaces/{id}/uploads
func (s *Service) ListUploads(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "viewer"); err != nil {
		return err
	}
	list, err := s.store.UploadsForWorkspace(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, list)
	return nil
}

// GET /workspaces/{id}/uploads/{uploadId}/file — streams an uploaded file (e.g. the PDF for the viewer).
func (s *Service) DownloadUpload(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	uid, err := httpx.IDParam(r, "uploadId")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "viewer"); err != nil {
		return err
	}
	u, err := s.store.UploadByID(r.Context(), id, uid)
	if err != nil {
		return err
	}
	if isLink(u.PathOrURL) || u.Kind == "note" || u.Kind == "repo_link" {
		return httpx.Errorf(http.StatusBadRequest, "this upload is a link, not a file")
	}
	ServeDataFile(w, r, s.cfg.DataDir, u.PathOrURL, u.OriginalName)
	return nil
}

// DELETE /workspaces/{id}/uploads/{uploadId}
func (s *Service) DeleteUpload(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	uid, err := httpx.IDParam(r, "uploadId")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "editor"); err != nil {
		return err
	}
	u, err := s.store.UploadByID(r.Context(), id, uid)
	if err != nil {
		return err
	}
	if err := s.store.DeleteUpload(r.Context(), id, uid); err != nil {
		return err
	}
	if !isLink(u.PathOrURL) && u.Kind != "note" && u.Kind != "repo_link" {
		if p, err := DataPath(s.cfg.DataDir, u.PathOrURL); err == nil {
			_ = os.Remove(p)
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// GET /workspaces/{id}/notes — the researcher's note first, then notes written by agents.
func (s *Service) GetNotes(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "viewer"); err != nil {
		return err
	}
	notes, err := s.store.NotesForWorkspace(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, notes)
	return nil
}

// PUT /workspaces/{id}/notes {"markdown": "..."} — saves the researchers' shared Markdown note.
func (s *Service) PutNotes(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := Access(r.Context(), s.store, id, "editor"); err != nil {
		return err
	}
	var body struct {
		Markdown string `json:"markdown"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if len(body.Markdown) > maxNoteBytes {
		return httpx.Errorf(http.StatusBadRequest, "note is too long (max 1 MB)")
	}
	n, err := s.store.UpsertResearcherNote(r.Context(), id, auth.UserID(r.Context()), body.Markdown)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, n)
	return nil
}

// ---------- file helpers ----------

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func sanitizeName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = unsafeName.ReplaceAllString(name, "_")
	name = strings.Trim(name, "._")
	if name == "" {
		name = "file"
	}
	if len(name) > 120 {
		name = name[len(name)-120:]
	}
	return name
}

func (s *Service) saveFile(ctx context.Context, wsID int64, kind string, fh *multipart.FileHeader) (*store.Upload, error) {
	limit := int64(maxDatasetBytes)
	if kind == "paper" {
		limit = maxPaperBytes
	}
	if fh.Size > limit {
		return nil, httpx.Errorf(http.StatusRequestEntityTooLarge, fmt.Sprintf("%s is too large", fh.Filename))
	}
	src, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	if kind == "paper" {
		head := make([]byte, 5)
		if _, err := io.ReadFull(src, head); err != nil || string(head) != "%PDF-" {
			return nil, httpx.Errorf(http.StatusBadRequest, fmt.Sprintf("%s is not a PDF file", fh.Filename))
		}
		if _, err := src.Seek(0, io.SeekStart); err != nil {
			return nil, err
		}
	}

	rel := filepath.ToSlash(filepath.Join("workspaces", fmt.Sprint(wsID), "uploads", kind+"s",
		auth.RandomToken(6)+"_"+sanitizeName(fh.Filename)))
	dst := filepath.Join(s.cfg.DataDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return nil, err
	}
	out, err := os.Create(dst)
	if err != nil {
		return nil, err
	}
	n, err := io.Copy(out, io.LimitReader(src, limit+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil || n > limit {
		os.Remove(dst)
		if err == nil {
			err = httpx.Errorf(http.StatusRequestEntityTooLarge, fh.Filename+" is too large")
		}
		return nil, err
	}
	u := &store.Upload{WorkspaceID: wsID, Kind: kind, PathOrURL: rel, OriginalName: fh.Filename, SizeBytes: n}
	if err := s.store.CreateUpload(ctx, u); err != nil {
		os.Remove(dst)
		return nil, err
	}
	return u, nil
}

func (s *Service) saveLink(ctx context.Context, wsID int64, kind, value string) (*store.Upload, error) {
	u := &store.Upload{WorkspaceID: wsID, Kind: kind, PathOrURL: value}
	return u, s.store.CreateUpload(ctx, u)
}

// DataPath resolves a DATA_DIR-relative path and refuses anything that escapes DATA_DIR.
func DataPath(dataDir, rel string) (string, error) {
	p := filepath.Join(dataDir, filepath.FromSlash(rel))
	r, err := filepath.Rel(dataDir, p)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes data dir")
	}
	return p, nil
}

func ServeDataFile(w http.ResponseWriter, r *http.Request, dataDir, rel, downloadName string) {
	p, err := DataPath(dataDir, rel)
	if err != nil {
		httpx.Fail(w, r, httpx.ErrForbidden)
		return
	}
	if downloadName != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", sanitizeName(downloadName)))
	}
	http.ServeFile(w, r, p)
}

func isLink(v string) bool { return strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") }

var arxivIDRe = regexp.MustCompile(`(?i)(?:arxiv\.org/(?:abs|pdf|e-print)/|arxiv:)?\s*((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?)(?:\.pdf)?/?$`)

// normalizeArxiv accepts "1503.02531", "arXiv:1503.02531", or an arxiv.org abs/pdf URL
// and returns "https://arxiv.org/abs/<id>".
func normalizeArxiv(s string) (string, error) {
	s = strings.TrimSpace(s)
	m := arxivIDRe.FindStringSubmatch(s)
	if m == nil {
		return "", httpx.Errorf(http.StatusBadRequest, "not a valid arXiv link or id: "+s)
	}
	return "https://arxiv.org/abs/" + m[1], nil
}

func validateHTTPURL(s string) error {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return httpx.Errorf(http.StatusBadRequest, "not a valid http(s) URL: "+s)
	}
	return nil
}

func validateRepoURL(s string) error {
	if err := validateHTTPURL(s); err != nil {
		return err
	}
	u, _ := url.Parse(strings.TrimSpace(s))
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return httpx.Errorf(http.StatusBadRequest, "repository link must look like https://github.com/owner/repo")
	}
	return nil
}

func first(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func nonEmpty(v []string) []string {
	out := []string{}
	for _, s := range v {
		for _, part := range strings.FieldsFunc(s, func(r rune) bool { return r == '\n' || r == ',' }) {
			if p := strings.TrimSpace(part); p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}
