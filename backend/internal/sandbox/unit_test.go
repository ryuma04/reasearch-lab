package sandbox

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// ---------- paths: invalid filenames and traversal ----------

func TestCleanRelRejectsTraversalAndOddNames(t *testing.T) {
	bad := []string{"", "../etc/passwd", "src/../../x.py", "/etc/passwd", "C:/Windows/x.py", `src\train.py`, "src//a.py",
		"./src/a.py", "src/.hidden.py", ".git/config", "src/a.py/", "src/CON.py", "src/nul", "src/a\x00.py", "src/a.py.",
		"src/" + strings.Repeat("a", 120) + ".py", "a/b/c/d/e/f/g/h/i.py", "src/a b.py", "src/ä.py"}
	for _, p := range bad {
		if _, err := CleanRel(p); err == nil {
			t.Errorf("CleanRel(%q) should fail", p)
		}
	}
	for _, p := range []string{"src/train.py", "configs/config.yaml", "results/metrics.json", "models/student-v1.pt"} {
		if got, err := CleanRel(p); err != nil || got != p {
			t.Errorf("CleanRel(%q) = %q, %v", p, got, err)
		}
	}
}

func TestEditableAndEntrypointPaths(t *testing.T) {
	for _, p := range []string{"src/train.py", "src/pkg/models.py", "configs/config.yaml", "tests/test_x.py", "requirements.txt"} {
		if _, err := EditablePath(p); err != nil {
			t.Errorf("%s should be editable: %v", p, err)
		}
	}
	for _, p := range []string{"results/metrics.json", "logs/execute-1.log", "models/m.pt", "src/run.sh", "train.py",
		"Dockerfile", "src/../results/metrics.json", "data/train.csv", "configs/secret.pem"} {
		if _, err := EditablePath(p); err == nil {
			t.Errorf("%s must not be editable", p)
		}
	}
	if _, err := EntrypointPath("src/train.py"); err != nil {
		t.Error(err)
	}
	for _, p := range []string{"configs/config.yaml", "results/x.py", "src/train.sh", "train.py", "../src/train.py"} {
		if _, err := EntrypointPath(p); err == nil {
			t.Errorf("%s must not be an entrypoint", p)
		}
	}
}

func TestArtifactRel(t *testing.T) {
	for _, p := range []string{"models/model.pt", "./results/plot.png", "results/sub/table.csv"} {
		if _, err := ArtifactRel(p); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	}
	for _, p := range []string{"src/train.py", "../models/m.pt", "/work/models/m.pt", "models", "data/x.csv", "results/../src/a.py"} {
		if _, err := ArtifactRel(p); err == nil {
			t.Errorf("%s must be rejected", p)
		}
	}
}

func TestResolveNoSymlinkRefusesLinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	os.WriteFile(secret, []byte("host secret"), 0o644)
	os.MkdirAll(filepath.Join(root, "results"), 0o755)
	if err := os.Symlink(secret, filepath.Join(root, "results", "metrics.json")); err != nil {
		t.Skipf("cannot create symlinks here: %v", err)
	}
	if _, err := ResolveNoSymlink(root, "results/metrics.json"); !errors.Is(err, ErrSymlink) {
		t.Fatalf("want ErrSymlink, got %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "models")); err == nil {
		if _, err := ResolveNoSymlink(root, "models/secret.txt"); !errors.Is(err, ErrSymlink) {
			t.Fatalf("directory link: want ErrSymlink, got %v", err)
		}
	}
	if _, err := LoadMetrics(root, nil, ArtifactLimits{}); err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("metrics.json symlink must be rejected, got %v", err)
	}
}

// ---------- metrics schema ----------

func TestParseMetricsStructuredAndLegacy(t *testing.T) {
	doc, decls, err := ParseMetrics([]byte(`{"schema_version":1,"metrics":{"acc":0.98,"loss":{"train":0.1}},
		"artifacts":[{"path":"models/m.pt","kind":"model"}],"metadata":{"dataset":"mnist"}}`), []string{"acc"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Metrics["acc"] != 0.98 || doc.Metrics["loss.train"] != 0.1 || len(decls) != 1 || doc.Legacy {
		t.Fatalf("unexpected doc %+v %+v", doc, decls)
	}
	doc, _, err = ParseMetrics([]byte(`{"teacher_test_errors": 120, "dataset": "mnist"}`), nil)
	if err != nil || !doc.Legacy || doc.Metrics["teacher_test_errors"] != 120 || len(doc.Metrics) != 1 {
		t.Fatalf("legacy: %+v %v", doc, err)
	}
}

func TestParseMetricsRejectsInvalid(t *testing.T) {
	cases := map[string]string{
		`{"metrics": {"acc": NaN}}`:             "non-finite",
		`{"acc": Infinity}`:                     "non-finite",
		`{"metrics": {"acc": -Infinity}}`:       "non-finite",
		`{"metrics": {"acc": 0.9`:               "not a valid JSON",
		`[1, 2]`:                                "not a valid JSON object",
		`{"metrics": {}}`:                       "no numeric metrics",
		`{"metrics": {"acc": null}}`:            "null",
		`{"metrics": {"acc": "0.98"}}`:          "must be a number",
		`{"metrics": {"acc": 1}, "score": 99}`:  "unexpected top-level key",
		`{"metrics": [1]}`:                      `"metrics" must be an object`,
		`{"dataset": "mnist"}`:                  "no numeric metrics",
		`{"metrics": {"a b": 1}}`:               "not allowed",
		`{"metrics": {"acc": 1}, "artifacts": 3}`: `"artifacts" must be a list`,
	}
	for in, want := range cases {
		if _, _, err := ParseMetrics([]byte(in), nil); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: want error containing %q, got %v", in, want, err)
		}
	}
	if _, _, err := ParseMetrics([]byte(`{"metrics": {"acc": 1}}`), []string{"acc", "test_errors"}); err == nil ||
		!strings.Contains(err.Error(), "missing required metrics: test_errors") {
		t.Errorf("missing required metric: %v", err)
	}
}

func writeProject(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestLoadMetricsArtifacts(t *testing.T) {
	root := writeProject(t, map[string]string{
		"results/metrics.json": `{"metrics":{"acc":0.9},"artifacts":[{"path":"models/clf.joblib","kind":"model"},{"path":"results/plot.png","kind":"figure"}]}`,
		"models/clf.joblib":    "x", "results/plot.png": "png", "models/extra.pt": "pt", "models/notes.bin": "?",
	})
	doc, err := LoadMetrics(root, nil, ArtifactLimits{MaxFileBytes: 1 << 20, MaxTotalBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Artifact{}
	for _, a := range doc.Artifacts {
		got[a.Path] = a
	}
	if got["models/clf.joblib"].Format != "joblib" || got["models/extra.pt"].Format != "torch" || got["models/extra.pt"].Kind != "model" {
		t.Fatalf("model artifacts: %+v", doc.Artifacts)
	}
	if got["models/notes.bin"].Kind != "other" || got["results/plot.png"].Kind != "figure" {
		t.Fatalf("other artifacts: %+v", doc.Artifacts)
	}
}

func TestLoadMetricsRejectsBadArtifacts(t *testing.T) {
	cases := map[string]map[string]string{
		"unexpected artifact path": {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"../../etc/passwd"}]}`},
		"inside results/ or models/": {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"src/train.py"}]}`,
			"src/train.py": "x"},
		"does not exist":   {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"models/missing.pt","kind":"model"}]}`},
		"unsupported format": {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"models/m.onnx","kind":"model","format":"onnx"}]}`,
			"models/m.onnx": "x"},
		"cannot tell how to load": {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"models/m.bin","kind":"model"}]}`,
			"models/m.bin": "x"},
		"larger than": {"results/metrics.json": `{"metrics":{"a":1}}`, "models/big.pt": strings.Repeat("x", 2048)},
		"unknown kind": {"results/metrics.json": `{"metrics":{"a":1},"artifacts":[{"path":"results/x.csv","kind":"secret"}]}`,
			"results/x.csv": "x"},
	}
	for want, files := range cases {
		root := writeProject(t, files)
		_, err := LoadMetrics(root, nil, ArtifactLimits{MaxFileBytes: 1024, MaxTotalBytes: 4096})
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v", want, err)
		}
	}
	if _, err := LoadMetrics(t.TempDir(), nil, ArtifactLimits{}); !errors.Is(err, errMetricsMissing) {
		t.Errorf("missing metrics.json: %v", err)
	}
}

// ---------- container security configuration ----------

func testSpec(network bool) Spec {
	return Spec{Name: "t", Image: "img", Cmd: []string{"python", "x.py"}, WorkDir: "/work", Network: network,
		Limits: Limits{NanoCPUs: 2e9, MemoryBytes: 4 << 30, Pids: 256, TmpfsBytes: 512 << 20},
		Mounts: []Mount{{Source: "/data/workspaces/1/runs/2/project", Target: "/work", ReadOnly: true}}}
}

func TestHostConfigIsLockedDown(t *testing.T) {
	hc := HostConfig(testSpec(false))
	if hc.Privileged || hc.NetworkMode != "none" || !hc.ReadonlyRootfs || hc.AutoRemove {
		t.Fatalf("privileged=%v network=%s readonly=%v", hc.Privileged, hc.NetworkMode, hc.ReadonlyRootfs)
	}
	if len(hc.CapDrop) != 1 || hc.CapDrop[0] != "ALL" || len(hc.CapAdd) != 0 {
		t.Fatalf("capabilities: drop=%v add=%v", hc.CapDrop, hc.CapAdd)
	}
	if len(hc.SecurityOpt) != 1 || hc.SecurityOpt[0] != "no-new-privileges:true" {
		t.Fatalf("security opts: %v", hc.SecurityOpt)
	}
	r := hc.Resources
	if r.NanoCPUs != 2e9 || r.Memory != 4<<30 || r.MemorySwap != r.Memory || r.PidsLimit == nil || *r.PidsLimit != 256 {
		t.Fatalf("resources: %+v", r)
	}
	if len(hc.Binds) != 0 || hc.PidMode != "" || hc.IpcMode != "private" || hc.UsernsMode != "" {
		t.Fatalf("namespaces/binds: %+v", hc)
	}
	if !strings.Contains(hc.Tmpfs["/tmp"], "size=") {
		t.Fatalf("tmpfs must be size-limited: %v", hc.Tmpfs)
	}
	for _, m := range hc.Mounts {
		if strings.Contains(m.Source, "docker.sock") {
			t.Fatal("docker socket mounted")
		}
	}
	if hc := HostConfig(testSpec(true)); hc.NetworkMode != "bridge" {
		t.Fatalf("install phase network = %s", hc.NetworkMode)
	}
	cc := ContainerConfig(testSpec(false))
	if cc.User != "1000:1000" || !cc.NetworkDisabled || cc.Labels[LabelSandbox] != "1" || cc.Tty {
		t.Fatalf("container config: %+v", cc)
	}
}

func TestValidateSpecPolicy(t *testing.T) {
	e := &Engine{AllowedRoot: filepath.FromSlash("/data")}
	ok := testSpec(false)
	ok.Mounts = []Mount{{Source: filepath.FromSlash("/data/workspaces/1/runs/2/project"), Target: "/work", ReadOnly: true}}
	if err := e.ValidateSpec(ok); err != nil {
		t.Fatal(err)
	}
	bad := map[string]Mount{
		"docker socket":        {Source: "/var/run/docker.sock", Target: "/work/sock"},
		"docker pipe":          {Source: `\\.\pipe\docker_engine`, Target: "/work/x"},
		"host root":            {Source: "/", Target: "/work"},
		"outside the root":     {Source: filepath.FromSlash("/home/user"), Target: "/work"},
		"whole data dir":       {Source: filepath.FromSlash("/data"), Target: "/work"},
		"escape":               {Source: filepath.FromSlash("/data/../etc"), Target: "/work"},
		"bad target":           {Source: filepath.FromSlash("/data/workspaces/1"), Target: "/etc"},
	}
	for name, m := range bad {
		s := testSpec(false)
		s.Mounts = []Mount{m}
		if err := e.ValidateSpec(s); err == nil {
			t.Errorf("%s: mount %+v must be refused", name, m)
		}
	}
	noLimits := ok
	noLimits.Limits.Pids = 0
	if err := e.ValidateSpec(noLimits); err == nil {
		t.Error("a spec without a process limit must be refused")
	}
}

func TestEffectiveLimitsAdaptToHost(t *testing.T) {
	want := Limits{NanoCPUs: 2e9, MemoryBytes: 4 << 30, Pids: 256, TmpfsBytes: 512 << 20}
	if got := EffectiveLimits(want, 16, 32<<30); got != want {
		t.Fatalf("big host should keep the defaults: %+v", got)
	}
	got := EffectiveLimits(want, 1, 2<<30)
	if got.NanoCPUs != 1e9 || got.MemoryBytes != (2<<30)*3/4 || got.TmpfsBytes > got.MemoryBytes/2 {
		t.Fatalf("small host: %+v", got)
	}
	cfg := &config.Config{SandboxCPUs: "2", SandboxMemory: "4g", SandboxPids: "128", SandboxTmpfs: "256m"}
	if l := ConfiguredLimits(cfg); l.NanoCPUs != 2e9 || l.MemoryBytes != 4<<30 || l.Pids != 128 || l.TmpfsBytes != 256<<20 {
		t.Fatalf("configured: %+v", l)
	}
}

// The project is mounted read-only; only results/, models/, data/ and caches are writable.
func TestMountsReadOnlyExceptOutputs(t *testing.T) {
	dataDir := t.TempDir()
	s := NewWithRunner(&config.Config{DataDir: dataDir}, nil, nil, &fakeRunner{})
	run := &store.Run{ID: 2, WorkspaceID: 1}
	project := s.ProjectDir(1, 2)
	for _, phase := range []string{"execute", "test", "install", "verify"} {
		rw := map[string]bool{}
		for _, m := range s.mountsFor(run, project, phase) {
			if m.Target == "/work" && !m.ReadOnly {
				t.Fatalf("%s: project root must be read-only", phase)
			}
			if m.Target == "/inputs" && !m.ReadOnly {
				t.Fatalf("%s: uploads must be read-only", phase)
			}
			if !m.ReadOnly {
				rw[m.Target] = true
			}
		}
		for _, forbidden := range []string{"/work/src", "/work/configs", "/work/tests", "/work/logs"} {
			if rw[forbidden] {
				t.Fatalf("%s: %s must not be writable", phase, forbidden)
			}
		}
		if phase == "verify" && len(rw) != 0 {
			t.Fatalf("verify must be fully read-only: %v", rw)
		}
		if phase == "execute" && !rw["/work/results"] {
			t.Fatal("execute must be able to write results/")
		}
		if (phase == "install") != rw["/work/requirements.txt"] {
			t.Fatalf("%s: requirements.txt writable=%v", phase, rw["/work/requirements.txt"])
		}
	}
}

// ---------- engine: timeout, cancellation, Docker unavailable ----------

type fakeRunner struct {
	pingErr error
	run     func(ctx context.Context) (int, error)
	removed int
}

func (f *fakeRunner) Ping(context.Context) error { return f.pingErr }
func (f *fakeRunner) ImagePresent(context.Context, string) (bool, error) {
	return f.pingErr == nil, f.pingErr
}
func (f *fakeRunner) HostResources(context.Context) (int, int64, error) { return 8, 16 << 30, f.pingErr }
func (f *fakeRunner) RemoveStale(context.Context) (int, error)          { return 0, nil }
func (f *fakeRunner) Run(ctx context.Context, _ Spec, stdout, _ io.Writer) (int, bool, error) {
	defer func() { f.removed++ }()
	if f.run != nil {
		code, err := f.run(ctx)
		return code, false, err
	}
	stdout.Write([]byte("hello\n"))
	return 0, false, nil
}

func blockUntilDone(ctx context.Context) (int, error) {
	<-ctx.Done()
	return -1, ctx.Err()
}

func engineFor(r Runner) *Engine { return &Engine{Runner: r, AllowedRoot: filepath.FromSlash("/data")} }

func TestEngineTimeout(t *testing.T) {
	f := &fakeRunner{run: blockUntilDone}
	out, err := engineFor(f).Run(context.Background(), testSpecIn(), 50*time.Millisecond, io.Discard, io.Discard)
	if err != nil || !out.TimedOut || out.Cancelled || out.ExitCode != -1 || f.removed != 1 {
		t.Fatalf("out=%+v err=%v removed=%d", out, err, f.removed)
	}
}

func TestEngineCancel(t *testing.T) {
	f := &fakeRunner{run: blockUntilDone}
	ctx, cancel := context.WithCancelCause(context.Background())
	time.AfterFunc(30*time.Millisecond, func() { cancel(errCancelled) })
	out, err := engineFor(f).Run(ctx, testSpecIn(), time.Minute, io.Discard, io.Discard)
	if err != nil || !out.Cancelled || out.TimedOut || f.removed != 1 {
		t.Fatalf("out=%+v err=%v removed=%d", out, err, f.removed)
	}
}

func TestEngineRefusesUnsafeSpecBeforeRunning(t *testing.T) {
	f := &fakeRunner{}
	s := testSpecIn()
	s.Mounts = append(s.Mounts, Mount{Source: "/var/run/docker.sock", Target: "/work/docker.sock"})
	if _, err := engineFor(f).Run(context.Background(), s, time.Minute, io.Discard, io.Discard); err == nil || f.removed != 0 {
		t.Fatalf("unsafe spec ran: err=%v", err)
	}
}

func testSpecIn() Spec {
	s := testSpec(false)
	s.Mounts = []Mount{{Source: filepath.FromSlash("/data/workspaces/1/runs/2/project"), Target: "/work", ReadOnly: true}}
	return s
}

func TestDockerUnavailable(t *testing.T) {
	r := NewDockerRunnerWithHost("tcp://127.0.0.1:1")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := r.Ping(ctx); !errors.Is(err, ErrDockerUnavailable) {
		t.Fatalf("Ping: want ErrDockerUnavailable, got %v", err)
	}
	_, err := engineFor(r).Run(ctx, testSpecIn(), 5*time.Second, io.Discard, io.Discard)
	if !errors.Is(err, ErrDockerUnavailable) {
		t.Fatalf("Run: want ErrDockerUnavailable, got %v", err)
	}
	s := NewWithRunner(&config.Config{DataDir: t.TempDir(), SandboxImagePython: "img", SandboxCPUs: "2", SandboxMemory: "4g",
		SandboxPids: "256", SandboxTmpfs: "512m"}, nil, nil, r)
	st := s.Status(ctx)
	if st["available"] != false || !strings.Contains(st["error"].(string), "Docker is not available") {
		t.Fatalf("status: %+v", st)
	}
}

func TestCapWriterLimitsLogs(t *testing.T) {
	var b strings.Builder
	w := &capWriter{w: &b, max: 10}
	w.Write([]byte("0123456789abcdef"))
	w.Write([]byte("more"))
	if !strings.HasPrefix(b.String(), "0123456789") || !strings.Contains(b.String(), "truncated") || strings.Contains(b.String(), "more") {
		t.Fatalf("got %q", b.String())
	}
}
