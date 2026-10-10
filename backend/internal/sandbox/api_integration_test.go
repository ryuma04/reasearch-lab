package sandbox

// End-to-end tests through the real HTTP handlers, Postgres and (where needed) Docker.
// Skipped unless TEST_DATABASE_URL points at a disposable database, e.g.
//   TEST_DATABASE_URL=postgres://lab:lab@localhost:5433/lab_test?sslmode=disable
// TEST_REDIS_URL defaults to redis://localhost:6379/15.

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
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type apiFixture struct {
	t       *testing.T
	st      *store.Store
	s       *Service
	router  http.Handler
	owner   int64
	other   int64
	run     *store.Run
	project string
}

func newAPIFixture(t *testing.T, runner Runner) *apiFixture {
	t.Helper()
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
	rurl := os.Getenv("TEST_REDIS_URL")
	if rurl == "" {
		rurl = "redis://localhost:6379/15"
	}
	b, err := bus.New(ctx, rurl, st)
	if err != nil {
		t.Fatal(err)
	}
	user := func(name string) int64 {
		var id int64
		if err := st.Pool.QueryRow(ctx, `INSERT INTO users (name) VALUES ($1) RETURNING id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	f := &apiFixture{t: t, st: st, owner: user("owner"), other: user("stranger")}
	ws, err := st.CreateWorkspace(ctx, f.owner, "sandbox test", "quick", "reproduce", "")
	if err != nil {
		t.Fatal(err)
	}
	f.run, err = st.CreateRun(ctx, ws.ID, "quick")
	if err != nil {
		t.Fatal(err)
	}
	// The plan was approved and the agents are waiting: the researcher may run code.
	_, _ = st.Pool.Exec(ctx, `UPDATE runs SET status='waiting_approval', stage='coding' WHERE id=$1`, f.run.ID)
	f.run.Status = "waiting_approval"

	cfg := &config.Config{DataDir: testDataDir(t), SandboxImagePython: testImage(), SandboxCPUs: "1", SandboxMemory: "1g",
		SandboxPids: "128", SandboxTmpfs: "64m", SandboxTimeoutSec: 90, SandboxMaxTimeoutSec: 600,
		SandboxMaxArtifactMB: 64, SandboxMaxArtifactTotalMB: 128}
	f.s = NewWithRunner(cfg, st, b, runner)
	f.project = f.s.ProjectDir(ws.ID, f.run.ID)
	os.MkdirAll(filepath.Join(f.project, "src"), 0o755)

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			id, _ := strconv.ParseInt(req.Header.Get("X-Test-User"), 10, 64)
			next.ServeHTTP(w, req.WithContext(auth.WithUserID(req.Context(), id)))
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.Require)
		f.s.Routes(r)
	})
	f.router = r
	return f
}

func (f *apiFixture) do(method, path string, user int64, body any) (*httptest.ResponseRecorder, map[string]any) {
	f.t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("X-Test-User", fmt.Sprint(user))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (f *apiFixture) runPath(suffix string) string { return fmt.Sprintf("/runs/%d%s", f.run.ID, suffix) }

func (f *apiFixture) save(rel, content string) {
	f.t.Helper()
	rec, out := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": rel, "content": content})
	if rec.Code != http.StatusOK {
		f.t.Fatalf("save %s: %d %v", rel, rec.Code, out)
	}
}

func (f *apiFixture) start(entry string) int64 {
	f.t.Helper()
	rec, out := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]any{"entrypoint": entry, "timeout_sec": 90})
	if rec.Code != http.StatusAccepted {
		f.t.Fatalf("start: %d %v", rec.Code, out)
	}
	if out["status"] != "running" {
		f.t.Fatalf("a started execution must report running, got %v", out["status"])
	}
	return int64(out["id"].(float64))
}

func (f *apiFixture) wait(execID int64) map[string]any {
	f.t.Helper()
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		_, out := f.do("GET", fmt.Sprintf("/sandbox/executions/%d", execID), f.owner, nil)
		if s := out["status"]; s != "running" && s != "queued" {
			return out
		}
		time.Sleep(300 * time.Millisecond)
	}
	f.t.Fatal("execution did not finish")
	return nil
}

func (f *apiFixture) logs(execID int64, stream string) string {
	_, out := f.do("GET", fmt.Sprintf("/sandbox/executions/%d/logs?stream=%s", execID, stream), f.owner, nil)
	s, _ := out["content"].(string)
	return s
}

// ---------- ownership and isolation ----------

func TestAPIWorkspaceOwnershipAndIsolation(t *testing.T) {
	f := newAPIFixture(t, &fakeRunner{})
	os.WriteFile(filepath.Join(f.project, "src", "train.py"), []byte("print(1)\n"), 0o644)

	// A stranger cannot see that the run exists, let alone change or execute it.
	for _, c := range []struct{ method, path string }{
		{"GET", f.runPath("/sandbox/executions")}, {"PUT", f.runPath("/file")},
		{"POST", f.runPath("/sandbox/executions")}, {"GET", f.runPath("/artifact?path=models/m.pt")},
	} {
		rec, _ := f.do(c.method, c.path, f.other, map[string]string{"path": "src/train.py", "content": "x", "entrypoint": "src/train.py"})
		if rec.Code != http.StatusNotFound {
			t.Errorf("stranger %s %s: %d, want 404", c.method, c.path, rec.Code)
		}
	}
	// Not logged in.
	if rec, _ := f.do("GET", f.runPath("/sandbox/executions"), 0, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", rec.Code)
	}
	// A viewer can read but not edit or execute.
	_, _ = f.st.Pool.Exec(context.Background(), `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`,
		f.run.WorkspaceID, f.other)
	if rec, _ := f.do("GET", f.runPath("/sandbox/executions"), f.other, nil); rec.Code != http.StatusOK {
		t.Errorf("viewer read: %d", rec.Code)
	}
	if rec, _ := f.do("PUT", f.runPath("/file"), f.other, map[string]string{"path": "src/train.py", "content": "x"}); rec.Code != http.StatusForbidden {
		t.Errorf("viewer save: %d", rec.Code)
	}
	if rec, _ := f.do("POST", f.runPath("/sandbox/executions"), f.other, map[string]string{"entrypoint": "src/train.py"}); rec.Code != http.StatusForbidden {
		t.Errorf("viewer execute: %d", rec.Code)
	}
	if b, _ := os.ReadFile(filepath.Join(f.project, "src", "train.py")); string(b) != "print(1)\n" {
		t.Error("a viewer changed a file")
	}
}

func TestAPIRejectsInvalidPaths(t *testing.T) {
	f := newAPIFixture(t, &fakeRunner{})
	for _, p := range []string{"../../../etc/passwd", "/etc/passwd", "src/../../x.py", "results/metrics.json", "logs/x.log",
		`src\..\x.py`, "src/.env", "Dockerfile", "src/run.sh"} {
		rec, out := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": p, "content": "x"})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("save %q: %d %v", p, rec.Code, out)
		}
	}
	for _, p := range []string{"../x.py", "configs/config.yaml", "/work/src/train.py", "src/missing.sh"} {
		rec, _ := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]string{"entrypoint": p})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("entrypoint %q: %d", p, rec.Code)
		}
	}
	for _, p := range []string{"../../go.mod", "src/train.py", "%2e%2e/x"} {
		rec, _ := f.do("GET", f.runPath("/artifact?path="+p), f.owner, nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("artifact %q: %d", p, rec.Code)
		}
	}
	// Oversized and binary content.
	big := strings.Repeat("x", MaxSourceBytes+10)
	if rec, _ := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": "src/a.py", "content": big}); rec.Code < 400 {
		t.Errorf("oversized save accepted: %d", rec.Code)
	}
	if rec, _ := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": "src/a.py", "content": "a\x00b"}); rec.Code != http.StatusBadRequest {
		t.Errorf("NUL content accepted: %d", rec.Code)
	}
}

func TestAPIDockerUnavailable(t *testing.T) {
	f := newAPIFixture(t, NewDockerRunnerWithHost("tcp://127.0.0.1:1"))
	f.save("src/train.py", "print(1)\n")
	rec, out := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]string{"entrypoint": "src/train.py"})
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(fmt.Sprint(out["error"]), "Docker is not available") {
		t.Fatalf("got %d %v", rec.Code, out)
	}
	_, st := f.do("GET", "/sandbox/status", f.owner, nil)
	if st["available"] != false {
		t.Fatalf("status: %v", st)
	}
}

func TestAPIRefusesWhileAgentsAreWorking(t *testing.T) {
	f := newAPIFixture(t, &fakeRunner{})
	f.save("src/train.py", "print(1)\n")
	_, _ = f.st.Pool.Exec(context.Background(), `UPDATE runs SET status='running' WHERE id=$1`, f.run.ID)
	if rec, _ := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]string{"entrypoint": "src/train.py"}); rec.Code != http.StatusConflict {
		t.Fatalf("got %d", rec.Code)
	}
}

// ---------- real Docker, end to end ----------

func TestAPIEndToEndRealDocker(t *testing.T) {
	r := dockerOrSkip(t)
	f := newAPIFixture(t, r)

	// 1. A successful experiment: real stdout, validated metrics, a loadable model, proof links.
	f.save("src/train.py", successScript)
	id := f.start("src/train.py")
	res := f.wait(id)
	if res["status"] != "succeeded" || res["exit_code"] != float64(0) || res["metrics_status"] != "valid" {
		t.Fatalf("success run: %v\nlog:\n%s", res, f.logs(id, "combined"))
	}
	if res["duration_ms"].(float64) <= 0 || res["source"] != "user" || res["attempt"].(float64) < 1 {
		t.Fatalf("metadata: %v", res)
	}
	metrics := res["metrics"].([]any)
	found := false
	for _, m := range metrics {
		mm := m.(map[string]any)
		if mm["name"] == "test_accuracy" && mm["value"] == 0.875 && mm["log_line"] != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("measured metric not recorded with a log line: %v", metrics)
	}
	arts := res["artifacts"].([]any)
	if len(arts) != 1 || arts[0].(map[string]any)["verified"] != true {
		t.Fatalf("artifacts: %v", arts)
	}
	if !strings.Contains(f.logs(id, "combined"), "test_accuracy: 0.875") {
		t.Fatal("logs endpoint does not return the real output")
	}
	rec, _ := f.do("GET", f.runPath("/artifact?path=models/net.pt"), f.owner, nil)
	if rec.Code != http.StatusOK || rec.Body.Len() == 0 || rec.Header().Get("Content-Disposition") == "" {
		t.Fatalf("artifact download: %d", rec.Code)
	}
	var n int
	_ = f.st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM metrics WHERE exec_id=$1`, id).Scan(&n)
	if n != 2 {
		t.Fatalf("metrics rows: %d", n)
	}
	// Another user cannot read this execution.
	if rec, _ := f.do("GET", fmt.Sprintf("/sandbox/executions/%d", id), f.other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger read exec: %d", rec.Code)
	}
	if rec, _ := f.do("GET", fmt.Sprintf("/sandbox/executions/%d/logs", id), f.other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger read logs: %d", rec.Code)
	}

	// 2. A Python exception: failed, stderr captured, no metrics recorded.
	f.save("src/train.py", "print('loading data', flush=True)\nraise ValueError('shape mismatch: 784 vs 28')\n")
	id = f.start("src/train.py")
	res = f.wait(id)
	if res["status"] != "failed" || res["exit_code"] != float64(1) || !strings.Contains(f.logs(id, "stderr"), "ValueError: shape mismatch") {
		t.Fatalf("exception run: %v", res)
	}
	if strings.Contains(f.logs(id, "stderr"), "loading data") {
		t.Fatal("stdout leaked into the stderr stream")
	}

	// 3. Invalid metrics (NaN) and missing metrics are rejected.
	f.save("src/train.py", "import json\njson.dump({'metrics': {'acc': float('nan')}}, open('results/metrics.json','w'))\n")
	res = f.wait(f.start("src/train.py"))
	if res["status"] != "failed" || res["metrics_status"] != "invalid" || !strings.Contains(fmt.Sprint(res["metrics_error"]), "non-finite") {
		t.Fatalf("NaN metrics: %v", res)
	}
	f.save("src/train.py", "print('done, but no results written')\n")
	res = f.wait(f.start("src/train.py"))
	if res["status"] != "failed" || res["metrics_status"] != "missing" {
		t.Fatalf("missing metrics: %v", res)
	}
	f.save("src/train.py", "import json\njson.dump({'metrics': {'acc': 1}, 'artifacts': [{'path': '../../../etc/passwd'}]}, open('results/metrics.json','w'))\n")
	res = f.wait(f.start("src/train.py"))
	if res["status"] != "failed" || !strings.Contains(fmt.Sprint(res["metrics_error"]), "unexpected artifact path") {
		t.Fatalf("bad artifact path: %v", res)
	}

	// 4. Cancellation: the container is killed and removed; a second start while running is refused.
	f.save("src/train.py", "import time\nprint('long training', flush=True)\ntime.sleep(300)\n")
	id = f.start("src/train.py")
	if rec, _ := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]string{"entrypoint": "src/train.py"}); rec.Code != http.StatusConflict {
		t.Fatalf("concurrent start: %d", rec.Code)
	}
	if rec, _ := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": "src/train.py", "content": "x"}); rec.Code != http.StatusConflict {
		t.Fatalf("save during execution: %d", rec.Code)
	}
	deadline := time.Now().Add(60 * time.Second)
	for !strings.Contains(f.logs(id, "combined"), "long training") && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	if rec, out := f.do("POST", fmt.Sprintf("/sandbox/executions/%d/cancel", id), f.other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger cancel: %d %v", rec.Code, out)
	}
	if rec, out := f.do("POST", fmt.Sprintf("/sandbox/executions/%d/cancel", id), f.owner, nil); rec.Code != http.StatusAccepted {
		t.Fatalf("cancel: %d %v", rec.Code, out)
	}
	res = f.wait(id)
	if res["status"] != "cancelled" || res["cancelled"] != true {
		t.Fatalf("cancelled run: %v", res)
	}
	ids, _ := r.ListSandboxContainers(context.Background(), fmt.Sprintf("tapu-sena.exec=%d", id))
	if len(ids) != 0 {
		t.Fatalf("container not removed after cancel: %v", ids)
	}

	// 5. Timeout.
	f.save("src/train.py", "import time\ntime.sleep(300)\n")
	rec, out := f.do("POST", f.runPath("/sandbox/executions"), f.owner, map[string]any{"entrypoint": "src/train.py", "timeout_sec": 3})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("start: %d %v", rec.Code, out)
	}
	res = f.wait(int64(out["id"].(float64)))
	if res["status"] != "timed_out" || res["timed_out"] != true {
		t.Fatalf("timeout run: %v", res)
	}

	// Every attempt is listed, newest first.
	_, _ = f.do("GET", f.runPath("/sandbox/executions"), f.owner, nil)
	rec2 := httptest.NewRecorder()
	req := httptest.NewRequest("GET", f.runPath("/sandbox/executions"), nil)
	req.Header.Set("X-Test-User", fmt.Sprint(f.owner))
	f.router.ServeHTTP(rec2, req)
	var list []map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &list)
	if len(list) != 7 || list[0]["status"] != "timed_out" || list[len(list)-1]["status"] != "succeeded" {
		t.Fatalf("history: %d entries", len(list))
	}
}
