package sandbox

// Real Docker tests. They are skipped when the daemon or the sandbox image is not available.
// Image: SANDBOX_TEST_IMAGE (default tapu-sena/sandbox-python:latest).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

var execSeq atomic.Int64

func init() { execSeq.Store(time.Now().UnixNano() % 1_000_000_000) }

func testImage() string {
	if v := os.Getenv("SANDBOX_TEST_IMAGE"); v != "" {
		return v
	}
	return "tapu-sena/sandbox-python:latest"
}

func dockerOrSkip(t *testing.T) *DockerRunner {
	t.Helper()
	r := NewDockerRunner()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := r.Ping(ctx); err != nil {
		t.Skipf("Docker not available: %v", err)
	}
	if ok, _ := r.ImagePresent(ctx, testImage()); !ok {
		t.Skipf("sandbox image %s not built", testImage())
	}
	return r
}

// testDataDir is inside the repository (not the OS temp dir, whose short 8.3 names Docker
// Desktop cannot always share on Windows).
func testDataDir(t *testing.T) string {
	t.Helper()
	base, _ := filepath.Abs(filepath.Join("..", "..", "sandbox-testdata"))
	if v := os.Getenv("SANDBOX_TEST_DIR"); v != "" {
		base = v
	}
	_ = os.MkdirAll(base, 0o755)
	dir, err := os.MkdirTemp(base, "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

type dockerFixture struct {
	s       *Service
	r       *DockerRunner
	run     *store.Run
	project string
}

func newDockerFixture(t *testing.T) *dockerFixture {
	r := dockerOrSkip(t)
	cfg := &config.Config{DataDir: testDataDir(t), SandboxImagePython: testImage(), SandboxCPUs: "1", SandboxMemory: "1g",
		SandboxPids: "128", SandboxTmpfs: "64m", SandboxTimeoutSec: 60, SandboxMaxTimeoutSec: 600,
		SandboxMaxArtifactMB: 64, SandboxMaxArtifactTotalMB: 128}
	s := NewWithRunner(cfg, nil, nil, r)
	run := &store.Run{ID: 7, WorkspaceID: 3, ComputeBudget: "quick"}
	project := s.ProjectDir(run.WorkspaceID, run.ID)
	if err := os.MkdirAll(filepath.Join(project, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.prepareProject(project); err != nil {
		t.Fatal(err)
	}
	return &dockerFixture{s: s, r: r, run: run, project: project}
}

// lineWriter is a thread-safe buffer that can signal when a marker appears.
type lineWriter struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	marker string
	seen   chan struct{}
	once   sync.Once
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf.Write(p)
	if w.marker != "" && strings.Contains(w.buf.String(), w.marker) {
		w.once.Do(func() { close(w.seen) })
	}
	return len(p), nil
}

func (w *lineWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

func (f *dockerFixture) run1(t *testing.T, ctx context.Context, script string, timeout time.Duration, stdout, stderr io.Writer) (Outcome, int64, error) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(f.project, "src", "main.py"), []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	execID := execSeq.Add(1)
	j := &job{run: f.run, phase: "execute", argv: []string{"python", "-u", "src/main.py"}, image: testImage(), env: map[string]string{}}
	spec := f.s.specFor(j, execID, f.project, f.s.Limits(ctx))
	out, err := f.s.engine.Run(ctx, spec, timeout, stdout, stderr)
	return out, execID, err
}

func (f *dockerFixture) assertRemoved(t *testing.T, execID int64) {
	t.Helper()
	ids, err := f.r.ListSandboxContainers(context.Background(), fmt.Sprintf("tapu-sena.exec=%d", execID))
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Fatalf("container for exec %d was not removed: %v", execID, ids)
	}
}

const successScript = `
import json, os, torch
print("training tiny model", flush=True)
net = torch.nn.Linear(4, 2)
x = torch.randn(64, 4)
loss = net(x).pow(2).mean()
loss.backward()
os.makedirs("models", exist_ok=True)
torch.save(net.state_dict(), "models/net.pt")
acc = 0.875
print(f"test_accuracy: {acc}", flush=True)
json.dump({"schema_version": 1, "metrics": {"test_accuracy": acc, "loss": float(loss)},
           "artifacts": [{"path": "models/net.pt", "kind": "model", "format": "torch"}]},
          open("results/metrics.json", "w"))
`

func TestDockerSuccessfulExperimentWritesValidatedMetricsAndLoadableModel(t *testing.T) {
	f := newDockerFixture(t)
	var stdout, stderr lineWriter
	out, execID, err := f.run1(t, context.Background(), successScript, 2*time.Minute, &stdout, &stderr)
	if err != nil || out.ExitCode != 0 || out.TimedOut || out.Cancelled {
		t.Fatalf("out=%+v err=%v stderr=%s", out, err, stderr.String())
	}
	if !strings.Contains(stdout.String(), "test_accuracy: 0.875") {
		t.Fatalf("stdout not captured: %q", stdout.String())
	}
	f.assertRemoved(t, execID)

	doc, err := LoadMetrics(f.project, []string{"test_accuracy"}, ArtifactLimits{MaxFileBytes: 64 << 20, MaxTotalBytes: 128 << 20})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Metrics["test_accuracy"] != 0.875 || len(doc.Artifacts) != 1 || doc.Artifacts[0].Format != "torch" {
		t.Fatalf("doc: %+v", doc)
	}
	var vlog bytes.Buffer
	j := &job{run: f.run, phase: "execute", image: testImage()}
	if err := f.s.verifyModels(context.Background(), j, execSeq.Add(1), f.project, f.s.Limits(context.Background()), doc.Artifacts, &vlog); err != nil {
		t.Fatalf("verify: %v\n%s", err, vlog.String())
	}
	if doc.Artifacts[0].Verified == nil || !*doc.Artifacts[0].Verified {
		t.Fatalf("model not marked verified: %+v\n%s", doc.Artifacts[0], vlog.String())
	}

	// A corrupt model file must fail verification.
	os.WriteFile(filepath.Join(f.project, "models", "net.pt"), []byte("not a model"), 0o644)
	doc, _ = LoadMetrics(f.project, nil, ArtifactLimits{})
	vlog.Reset()
	if err := f.s.verifyModels(context.Background(), j, execSeq.Add(1), f.project, f.s.Limits(context.Background()), doc.Artifacts, &vlog); err == nil ||
		!strings.Contains(err.Error(), "could not be loaded") {
		t.Fatalf("corrupt model accepted: %v\n%s", err, vlog.String())
	}
}

func TestDockerPythonExceptionCapturesStderr(t *testing.T) {
	f := newDockerFixture(t)
	var stdout, stderr lineWriter
	out, execID, err := f.run1(t, context.Background(), "print('before the error', flush=True)\n1/0\n", time.Minute, &stdout, &stderr)
	if err != nil {
		t.Fatal(err)
	}
	if out.ExitCode != 1 || out.TimedOut {
		t.Fatalf("exit=%d", out.ExitCode)
	}
	if !strings.Contains(stderr.String(), "ZeroDivisionError") || strings.Contains(stdout.String(), "ZeroDivisionError") {
		t.Fatalf("stderr=%q stdout=%q", stderr.String(), stdout.String())
	}
	if !strings.Contains(stdout.String(), "before the error") {
		t.Fatalf("stdout=%q", stdout.String())
	}
	f.assertRemoved(t, execID)
}

func TestDockerTimeoutKillsAndRemovesContainer(t *testing.T) {
	f := newDockerFixture(t)
	start := time.Now()
	out, execID, err := f.run1(t, context.Background(), "import time\nprint('sleeping', flush=True)\ntime.sleep(120)\n", 4*time.Second, io.Discard, io.Discard)
	if err != nil || !out.TimedOut || out.ExitCode != -1 {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	if time.Since(start) > 60*time.Second {
		t.Fatalf("timeout took %s", time.Since(start))
	}
	f.assertRemoved(t, execID)
}

func TestDockerCancelKillsAndRemovesContainer(t *testing.T) {
	f := newDockerFixture(t)
	stdout := &lineWriter{marker: "started", seen: make(chan struct{})}
	ctx, cancel := context.WithCancelCause(context.Background())
	go func() {
		select {
		case <-stdout.seen:
		case <-time.After(60 * time.Second):
		}
		cancel(errCancelled)
	}()
	out, execID, err := f.run1(t, ctx, "import time\nprint('started', flush=True)\ntime.sleep(120)\n", 2*time.Minute, stdout, io.Discard)
	if err != nil || !out.Cancelled || out.TimedOut {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	f.assertRemoved(t, execID)
}

const isolationScript = `
import json, os, socket
r = {"uid": os.getuid()}
def can_write(p):
    try:
        with open(p, "w") as f: f.write("x")
        return True
    except OSError:
        return False
r["write_src"] = can_write("/work/src/planted.py")
r["write_root"] = can_write("/work/planted.txt")
r["write_usr"] = can_write("/usr/planted.txt")
r["write_results"] = can_write("/work/results/ok.txt")
r["write_models"] = can_write("/work/models/ok.bin")
r["write_tmp"] = can_write("/tmp/ok.txt")
try:
    s = socket.create_connection(("1.1.1.1", 53), timeout=3); s.close(); r["network"] = True
except OSError:
    r["network"] = False
def read(p):
    try: return open(p).read().strip()
    except OSError: return ""
r["memory_max"] = read("/sys/fs/cgroup/memory.max") or read("/sys/fs/cgroup/memory/memory.limit_in_bytes")
r["pids_max"] = read("/sys/fs/cgroup/pids.max") or read("/sys/fs/cgroup/pids/pids.max")
r["cpu_max"] = read("/sys/fs/cgroup/cpu.max")
st = read("/proc/self/status")
r["cap_eff"] = [l.split()[1] for l in st.splitlines() if l.startswith("CapEff")][0]
r["no_new_privs"] = [l.split()[1] for l in st.splitlines() if l.startswith("NoNewPrivs")][0]
r["docker_sock"] = os.path.exists("/var/run/docker.sock")
print("RESULT " + json.dumps(r), flush=True)
`

func TestDockerIsolationLimitsAndNoNetwork(t *testing.T) {
	f := newDockerFixture(t)
	var stdout, stderr lineWriter
	out, _, err := f.run1(t, context.Background(), isolationScript, time.Minute, &stdout, &stderr)
	if err != nil || out.ExitCode != 0 {
		t.Fatalf("out=%+v err=%v stderr=%s", out, err, stderr.String())
	}
	_, after, ok := strings.Cut(stdout.String(), "RESULT ")
	if !ok {
		t.Fatalf("no result: %s", stdout.String())
	}
	t.Logf("observed inside the container: %s", strings.TrimSpace(after))
	var r struct {
		WriteSrc, WriteRoot, WriteUsr, WriteResults, WriteModels bool
		WriteTmp, Network, DockerSock                            bool
		MemoryMax, PidsMax, CPUMax, CapEff, NoNewPrivs           string
	}
	raw := map[string]any{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(after)), &raw); err != nil {
		t.Fatal(err)
	}
	r.WriteSrc, r.WriteRoot, r.WriteUsr = raw["write_src"] == true, raw["write_root"] == true, raw["write_usr"] == true
	r.WriteResults, r.WriteModels, r.WriteTmp = raw["write_results"] == true, raw["write_models"] == true, raw["write_tmp"] == true
	r.Network, r.DockerSock = raw["network"] == true, raw["docker_sock"] == true
	r.MemoryMax, r.PidsMax, r.CPUMax = fmt.Sprint(raw["memory_max"]), fmt.Sprint(raw["pids_max"]), fmt.Sprint(raw["cpu_max"])
	r.CapEff, r.NoNewPrivs = fmt.Sprint(raw["cap_eff"]), fmt.Sprint(raw["no_new_privs"])

	if raw["uid"] != float64(1000) {
		t.Errorf("runs as uid %v, want 1000", raw["uid"])
	}
	if r.WriteSrc || r.WriteRoot || r.WriteUsr {
		t.Errorf("read-only paths were writable: src=%v root=%v usr=%v", r.WriteSrc, r.WriteRoot, r.WriteUsr)
	}
	if !r.WriteResults || !r.WriteModels || !r.WriteTmp {
		t.Errorf("output paths must be writable: results=%v models=%v tmp=%v", r.WriteResults, r.WriteModels, r.WriteTmp)
	}
	if r.Network {
		t.Error("network access must be disabled during execution")
	}
	if r.DockerSock {
		t.Error("the Docker socket is visible inside the container")
	}
	lim := f.s.Limits(context.Background())
	if r.MemoryMax != fmt.Sprint(lim.MemoryBytes) {
		t.Errorf("memory limit %s, want %d", r.MemoryMax, lim.MemoryBytes)
	}
	if r.PidsMax != fmt.Sprint(lim.Pids) {
		t.Errorf("pids limit %s, want %d", r.PidsMax, lim.Pids)
	}
	if r.CPUMax != "" && !strings.HasPrefix(r.CPUMax, fmt.Sprint(int64(lim.CPUs()*100000))) {
		t.Errorf("cpu.max %q does not match %.1f CPUs", r.CPUMax, lim.CPUs())
	}
	if r.CapEff != "0000000000000000" || r.NoNewPrivs != "1" {
		t.Errorf("capabilities %s, no_new_privs %s", r.CapEff, r.NoNewPrivs)
	}
	if _, err := os.Stat(filepath.Join(f.project, "src", "planted.py")); err == nil {
		t.Error("container wrote into src/ on the host")
	}
}
