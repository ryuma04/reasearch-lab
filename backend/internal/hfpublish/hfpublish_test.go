package hfpublish

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

func writeFiles(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, c := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func yes() *bool { b := true; return &b }
func no() *bool  { b := false; return &b }

var project = map[string]string{
	"models/clf.joblib":        "model-bytes",
	"models/unverified.pt":     "other",
	"results/metrics.json":     `{"metrics":{"acc":0.95}}`,
	"results/junit.xml":        "<x/>",
	"configs/config.yaml":      "seed: 0\n",
	"requirements.txt":         "scikit-learn\n",
	"src/train.py":             "print(1)\n",
	"tests/test_x.py":          "def test(): pass\n",
	"data/train.csv":           "1,2,3\n",
	"logs/execute-1.log":       "log\n",
	".pydeps/lib/x.py":         "x\n",
	".env":                     "SECRET=1\n",
}

var arts = []sandbox.Artifact{{Path: "models/clf.joblib", Kind: "model", Verified: yes()}, {Path: "models/unverified.pt", Kind: "model", Verified: no()}}

func TestSelectIncludesOnlyVerifiedModelAndRequiredFiles(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, project)
	sel, err := Select(context.Background(), root, arts, false, 1<<20, "no-gitleaks-here")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range sel.Files {
		got = append(got, f.Path+":"+f.Kind)
		if len(f.SHA256) != 64 || f.Size == 0 {
			t.Errorf("%s: missing hash or size", f.Path)
		}
	}
	want := "models/clf.joblib:model results/metrics.json:metrics configs/config.yaml:config requirements.txt:requirements"
	if strings.Join(got, " ") != want {
		t.Fatalf("files: %v", got)
	}
	reasons := map[string]string{}
	for _, e := range sel.Excluded {
		reasons[e.Path] = e.Reason
	}
	for p, want := range map[string]string{"data/": "dataset", "logs/": "logs", ".pydeps/": "dependencies", "tests/": "tests",
		"models/unverified.pt": "not verified", "results/junit.xml": "other result", "src/train.py": "Include code"} {
		if !strings.Contains(reasons[p], want) {
			t.Errorf("%s excluded for %q, want %q", p, reasons[p], want)
		}
	}
	if len(sel.Blockers) != 0 {
		t.Fatalf("blockers: %v", sel.Blockers)
	}
	sel, _ = Select(context.Background(), root, arts, true, 1<<20, "")
	found := false
	for _, f := range sel.Files {
		found = found || f.Path == "src/train.py" && !f.Required
	}
	if !found {
		t.Fatal("include code should add src/train.py as optional")
	}
}

func TestSelectBlocksSecretsMissingModelAndLargeFiles(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{"results/metrics.json": `{"metrics":{"a":1}}`,
		"configs/config.yaml": "aws_secret_access_key = \"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\"\nghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
		"models/big.pt":       strings.Repeat("x", 4096)})
	big := []sandbox.Artifact{{Path: "models/big.pt", Kind: "model", Verified: yes()}}
	sel, err := Select(context.Background(), root, big, false, 1024, "")
	if err != nil {
		t.Fatal(err)
	}
	all := strings.Join(sel.Blockers, "\n")
	if !strings.Contains(all, "possible secret") || !strings.Contains(all, "no model file") || !strings.Contains(all, "larger than") {
		t.Fatalf("blockers: %v", sel.Blockers)
	}
	for _, f := range sel.Files {
		if f.Path == "configs/config.yaml" {
			t.Fatal("a file with a secret was selected")
		}
	}
	sel, _ = Select(context.Background(), t.TempDir(), nil, false, 0, "")
	if !strings.Contains(strings.Join(sel.Blockers, " "), "metrics.json") {
		t.Fatalf("missing metrics must block: %v", sel.Blockers)
	}
}

func TestSelectSkipsSymlinks(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, map[string]string{"results/metrics.json": "{}", "models/m.joblib": "m"})
	secret := filepath.Join(t.TempDir(), "host.txt")
	_ = os.WriteFile(secret, []byte("host"), 0o644)
	if err := os.Symlink(secret, filepath.Join(root, "configs.yaml")); err != nil {
		t.Skip("symlinks not available")
	}
	_ = os.MkdirAll(filepath.Join(root, "configs"), 0o755)
	_ = os.Symlink(secret, filepath.Join(root, "configs", "config.yaml"))
	sel, _ := Select(context.Background(), root, []sandbox.Artifact{{Path: "models/m.joblib", Kind: "model", Verified: yes()}}, false, 0, "")
	for _, f := range sel.Files {
		if f.Path == "configs/config.yaml" {
			t.Fatal("followed a symlink")
		}
	}
}

func TestValidateRepoName(t *testing.T) {
	for _, ok := range []string{"my-model", "Ryuma04/digits-run-33", "a", "x.y_z"} {
		if _, err := ValidateRepoName(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "a/b/c", "-x", "x-", "a--b", "a..b", "has space", "../x", "x/", strings.Repeat("a", 97)} {
		if _, err := ValidateRepoName(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestModelCardUsesOnlyRecordedFacts(t *testing.T) {
	page := 3
	card := BuildModelCard(CardInfo{RepoID: "Ryuma04/digits", RunID: 33, ExecID: 7, CodeVersion: "a1b2c3",
		Papers:   []CardPaper{{Title: "Distilling the Knowledge", ArxivID: "1503.02531"}},
		Settings: []CardSetting{{Name: "train.epochs", Value: "3", Source: "compute_change"}, {Name: "seed", Value: "0", Source: "assumption"}},
		Metrics:  []CardMetric{{Name: "test_accuracy", Value: 0.951852}, {Name: "train_seconds", Value: 2}},
		Claims:   []CardClaim{{MetricName: "test_accuracy", Value: 0.97, Page: &page}},
		Files:    []FileItem{{Path: "models/net.pt", Size: 2048, SHA256: strings.Repeat("ab", 32), Kind: "model"}}})
	for _, want := range []string{"library_name: pytorch", "arxiv:1503.02531", "Run ID: 33", "`a1b2c3`",
		"| test_accuracy | 0.951852 | 0.97 (page 3) |", "| train_seconds | 2 | Not reported |", "changed to fit compute",
		"## Limitations", "train.epochs, seed", "`models/net.pt`"} {
		if !strings.Contains(card, want) {
			t.Errorf("card is missing %q\n%s", want, card)
		}
	}
	empty := BuildModelCard(CardInfo{RunID: 5, Files: []FileItem{{Path: "models/m.joblib", SHA256: "abc", Kind: "model"}}})
	if strings.Count(empty, "Not recorded") < 4 || strings.Contains(empty, "library_name") || strings.Contains(empty, "arxiv") {
		t.Fatalf("missing facts must say Not recorded, never guess:\n%s", empty)
	}
}

// ---------- handlers (needs TEST_DATABASE_URL) ----------

type fixture struct {
	t      *testing.T
	st     *store.Store
	b      *bus.Bus
	router http.Handler
	owner  int64
	other  int64
	run    *store.Run
}

func newFixture(t *testing.T, token string) *fixture {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	b, err := bus.New(ctx, "redis://localhost:6379/15", st)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, st: st, b: b}
	user := func() int64 {
		var id int64
		_ = st.Pool.QueryRow(ctx, `INSERT INTO users (name) VALUES ('u') RETURNING id`).Scan(&id)
		return id
	}
	f.owner, f.other = user(), user()
	ws, _ := st.CreateWorkspace(ctx, f.owner, "Digits Demo!", "quick", "reproduce", "")
	f.run, _ = st.CreateRun(ctx, ws.ID, "quick")
	_, _ = st.Pool.Exec(ctx, `UPDATE runs SET status='completed' WHERE id=$1`, f.run.ID)
	dataDir := t.TempDir()
	cfg := &config.Config{DataDir: dataDir, HFToken: token, SandboxMaxArtifactMB: 64}
	writeFiles(t, filepath.Join(dataDir, filepath.FromSlash(sandbox.ProjectRel(ws.ID, f.run.ID))), project)
	artsJSON, _ := json.Marshal(arts)
	var execID int64
	_ = st.Pool.QueryRow(ctx, `INSERT INTO sandbox_execs (run_id, phase, command, status, metrics_status, artifacts, code_version)
		VALUES ($1,'execute','python src/train.py','succeeded','valid',$2,'a1b2c3') RETURNING id`, f.run.ID, artsJSON).Scan(&execID)
	_, _ = st.Pool.Exec(ctx, `INSERT INTO metrics (run_id, exec_id, name, value) VALUES ($1,$2,'acc',0.95)`, f.run.ID, execID)
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			id, _ := strconv.ParseInt(req.Header.Get("X-Test-User"), 10, 64)
			next.ServeHTTP(w, req.WithContext(auth.WithUserID(req.Context(), id)))
		})
	})
	r.Group(func(r chi.Router) { r.Use(auth.Require); New(cfg, st, b).Routes(r) })
	f.router = r
	_ = b.Redis.Del(ctx, bus.JobsKey)
	return f
}

func (f *fixture) do(method, path string, user int64, body any) (*httptest.ResponseRecorder, map[string]any) {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, fmt.Sprintf("/runs/%d%s", f.run.ID, path), &buf)
	req.Header.Set("X-Test-User", fmt.Sprint(user))
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestHandlersPreviewPublishAndOwnership(t *testing.T) {
	f := newFixture(t, "hf_fake")
	ctx := context.Background()
	if rec, _ := f.do("GET", "/huggingface/preview", f.other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger preview: %d", rec.Code)
	}
	rec, p := f.do("GET", "/huggingface/preview", f.owner, nil)
	if rec.Code != 200 || p["configured"] != true || len(p["blockers"].([]any)) != 0 || len(p["files"].([]any)) != 4 {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
	}
	if p["suggested_repo"] != fmt.Sprintf("digits-demo-run-%d", f.run.ID) || !strings.Contains(p["model_card"].(string), "| acc | 0.95 |") {
		t.Fatalf("preview content: %v %v", p["suggested_repo"], p["model_card"])
	}
	if strings.Contains(rec.Body.String(), "hf_fake") {
		t.Fatal("the token leaked into a response")
	}
	for _, body := range []map[string]any{{"repo": "ok", "private": true}, {"repo": "bad name", "private": true, "confirm": true}, {"repo": "ok", "confirm": true}} {
		if rec, _ := f.do("POST", "/huggingface", f.owner, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%v: %d", body, rec.Code)
		}
	}
	rec, pub := f.do("POST", "/huggingface", f.owner, map[string]any{"repo": "digits", "private": true, "confirm": true})
	if rec.Code != http.StatusAccepted || pub["status"] != "queued" || pub["private"] != true || pub["files_total"] != float64(5) {
		t.Fatalf("publish: %d %s", rec.Code, rec.Body.String())
	}
	raw, _ := f.b.Redis.LIndex(ctx, bus.JobsKey, 0).Result()
	if !strings.Contains(raw, `"type":"hf_publish"`) || strings.Contains(raw, "hf_fake") {
		t.Fatalf("job: %s", raw)
	}
	if rec, _ := f.do("POST", "/huggingface", f.owner, map[string]any{"repo": "digits", "private": true, "confirm": true}); rec.Code != http.StatusConflict {
		t.Fatalf("second publish while one is running: %d", rec.Code)
	}
	if rec, _ := f.do("POST", "/huggingface", f.other, map[string]any{"repo": "x", "private": true, "confirm": true}); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger publish: %d", rec.Code)
	}
	rec, _ = f.do("GET", "/huggingface", f.owner, nil)
	var list []Publication
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].RepoName != "digits" {
		t.Fatalf("list: %s", rec.Body.String())
	}
	_ = f.b.Redis.Del(ctx, bus.JobsKey)
}

func TestPreviewWithoutTokenOrVerifiedRun(t *testing.T) {
	f := newFixture(t, "")
	_, p := f.do("GET", "/huggingface/preview", f.owner, nil)
	if !strings.Contains(fmt.Sprint(p["blockers"]), "HF_TOKEN") {
		t.Fatalf("missing token must block: %v", p["blockers"])
	}
	_, _ = f.st.Pool.Exec(context.Background(), `UPDATE sandbox_execs SET metrics_status='invalid' WHERE run_id=$1`, f.run.ID)
	_, p = f.do("GET", "/huggingface/preview", f.owner, nil)
	if !strings.Contains(fmt.Sprint(p["blockers"]), "no successful run") {
		t.Fatalf("no verified run must block: %v", p["blockers"])
	}
	if rec, _ := f.do("POST", "/huggingface", f.owner, map[string]any{"repo": "x", "private": true, "confirm": true}); rec.Code != http.StatusConflict {
		t.Fatalf("publish with blockers: %d", rec.Code)
	}
}
