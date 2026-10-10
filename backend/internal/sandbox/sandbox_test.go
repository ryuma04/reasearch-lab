package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Regression test for audit SEC-01: code running in the sandbox can write anything inside the
// project folder, including a .git directory with hooks or an fsmonitor command. The host-side
// snapshot must never execute them.
func TestCodeVersionIgnoresPlantedGitMetadata(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	runDir := t.TempDir()
	project := filepath.Join(runDir, "project")
	sentinel := filepath.Join(runDir, "pwned")
	if err := os.MkdirAll(filepath.Join(project, ".git", "hooks"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "train.py"), []byte("print('hi')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// What malicious sandboxed code would plant.
	hook := "#!/bin/sh\necho x > '" + filepath.ToSlash(sentinel) + "'\n"
	fsmon := "echo x > '" + filepath.ToSlash(sentinel) + "'"
	if runtime.GOOS == "windows" {
		fsmon = "cmd /c echo x > \"" + sentinel + "\""
	}
	_ = os.WriteFile(filepath.Join(project, ".git", "hooks", "pre-commit"), []byte(hook), 0o755)
	_ = os.WriteFile(filepath.Join(project, ".git", "hooks", "post-commit"), []byte(hook), 0o755)
	_ = os.WriteFile(filepath.Join(project, ".git", "config"),
		[]byte("[core]\n\tfsmonitor = "+fsmon+"\n\thooksPath = .git/hooks\n"), 0o644)
	_ = os.WriteFile(filepath.Join(project, ".git", "HEAD"), []byte("ref: refs/heads/main\n"), 0o644)

	s := &Service{}
	v1 := s.codeVersion(project)
	if v1 == "" || strings.HasPrefix(v1, "sha256:") {
		t.Fatalf("expected a git commit hash, got %q", v1)
	}
	// Planted hooks in the snapshot repo itself are impossible (it is outside the mount), but
	// make sure repeated snapshots still do not run anything.
	_ = os.WriteFile(filepath.Join(project, "train.py"), []byte("print('changed')\n"), 0o644)
	v2 := s.codeVersion(project)
	if v2 == v1 {
		t.Fatalf("code change did not produce a new version (%s)", v2)
	}
	if _, err := os.Stat(sentinel); err == nil {
		t.Fatal("host executed a hook or fsmonitor planted by sandboxed code")
	}
	rel, err := filepath.Rel(project, GitDir(project))
	if err != nil || !strings.HasPrefix(rel, "..") {
		t.Fatalf("snapshot repository %s must live outside the mounted project", GitDir(project))
	}
}
