package runs

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestValidateChangeText(t *testing.T) {
	for _, bad := range []string{"", "   ", "fix", "make it better", strings.Repeat("word ", 1000)} {
		if bad == "make it better" {
			continue // three words is the minimum and is allowed
		}
		if _, err := validateChangeText(bad); err == nil {
			t.Errorf("%q should be rejected", bad[:min(len(bad), 20)])
		}
	}
	got, err := validateChangeText("  Use a modular monolith and add tests  ")
	if err != nil || got != "Use a modular monolith and add tests" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestRequestHashIgnoresCaseAndSpacing(t *testing.T) {
	a := requestHash("Use a  Modular monolith")
	if a != requestHash("use a modular   monolith\n") {
		t.Fatal("the same words must give the same hash so a retry returns the same version")
	}
	if a == requestHash("use a microservice architecture") {
		t.Fatal("different requests must differ")
	}
}

func TestLineDiffMarksOnlyRealChanges(t *testing.T) {
	old := strings.Split("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk", "\n")
	neu := strings.Split("a\nb\nc\nd\ne\nCHANGED\ng\nh\ni\nj\nk", "\n")
	d := lineDiff(old, neu, 2)
	var minus, plus, collapsed int
	for _, l := range d {
		switch {
		case l == "- f":
			minus++
		case l == "+ CHANGED":
			plus++
		case strings.HasPrefix(l, "@@"):
			collapsed++
		}
	}
	if minus != 1 || plus != 1 || collapsed == 0 {
		t.Fatalf("diff = %q", d)
	}
	if len(lineDiff(old, old, 2)) == 0 {
		t.Fatal("identical input still yields its (collapsed) lines")
	}
}

func TestDiffTreesShowsOldAndNewCodeAndLeavesTheSourceUntouched(t *testing.T) {
	oldRoot, newRoot := t.TempDir(), t.TempDir()
	write(t, oldRoot, "src/train.py", "lr = 0.05\nprint('train')\n")
	write(t, oldRoot, "src/removed.py", "x = 1\n")
	write(t, oldRoot, "requirements.txt", "numpy\n")
	write(t, newRoot, "src/train.py", "lr = 0.01\nprint('train')\n")
	write(t, newRoot, "tests/test_new.py", "def test_x():\n    assert True\n")
	write(t, newRoot, "requirements.txt", "numpy\n")
	write(t, oldRoot, "results/metrics.json", "{}") // outside the compared folders
	before, _ := os.ReadFile(filepath.Join(oldRoot, "src", "train.py"))

	files, _ := diffTrees(oldRoot, newRoot)
	status := map[string]FileDiff{}
	for _, f := range files {
		status[f.Path] = f
	}
	if len(files) != 3 || status["src/train.py"].Status != "modified" || status["src/removed.py"].Status != "removed" || status["tests/test_new.py"].Status != "added" {
		t.Fatalf("files = %+v", files)
	}
	if tr := status["src/train.py"]; tr.Added != 1 || tr.Removed != 1 {
		t.Fatalf("expected one added and one removed line, got %+v", tr)
	}
	if _, listed := status["requirements.txt"]; listed {
		t.Fatal("an unchanged file must not be listed")
	}
	after, _ := os.ReadFile(filepath.Join(oldRoot, "src", "train.py"))
	if string(before) != string(after) {
		t.Fatal("comparing must not modify a version")
	}
}

func TestDiffSkipsBinaryAndOversizedFilesAndReportsThem(t *testing.T) {
	root := t.TempDir()
	write(t, root, "src/ok.py", "x = 1\n")
	write(t, root, "src/blob.bin", "a\x00b")
	write(t, root, "src/huge.py", strings.Repeat("x = 1\n", 60000))
	files, skipped := codeFiles(root)
	if _, ok := files["src/ok.py"]; !ok || len(files) != 1 {
		t.Fatalf("files = %v", files)
	}
	if skipped["src/blob.bin"] != "binary file" || skipped["src/huge.py"] == "" {
		t.Fatalf("skipped = %v", skipped)
	}
}

func TestDiffDoesNotFollowSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs privileges on Windows")
	}
	root, outside := t.TempDir(), t.TempDir()
	write(t, outside, "secret.txt", "TOP SECRET")
	write(t, root, "src/ok.py", "x = 1\n")
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "src", "link.py")); err != nil {
		t.Skip(err)
	}
	files, _ := codeFiles(root)
	for _, v := range files {
		if strings.Contains(v, "TOP SECRET") {
			t.Fatal("a planted symlink was followed")
		}
	}
}

func TestMetricRowsPairByNameAndKeepMissingSidesNil(t *testing.T) {
	rows := metricRows(map[string]float64{"acc": 0.9, "only_old": 1}, map[string]float64{"acc": 0.95, "only_new": 2})
	if len(rows) != 3 || rows[0].Name != "acc" || *rows[0].Old != 0.9 || *rows[0].New != 0.95 {
		t.Fatalf("rows = %+v", rows)
	}
	if rows[1].Name != "only_new" || rows[1].Old != nil || rows[2].Name != "only_old" || rows[2].New != nil {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestSetDiff(t *testing.T) {
	added, removed := setDiff([]string{"a", "b"}, []string{"b", "c"})
	if len(added) != 1 || added[0] != "c" || len(removed) != 1 || removed[0] != "a" {
		t.Fatalf("added %v removed %v", added, removed)
	}
}
