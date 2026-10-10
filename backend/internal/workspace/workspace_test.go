package workspace

import (
	"path/filepath"
	"testing"
)

func TestNormalizeArxiv(t *testing.T) {
	cases := map[string]string{
		"1503.02531":                           "https://arxiv.org/abs/1503.02531",
		"arXiv:1503.02531v1":                   "https://arxiv.org/abs/1503.02531v1",
		"https://arxiv.org/abs/1503.02531":     "https://arxiv.org/abs/1503.02531",
		"https://arxiv.org/pdf/1503.02531.pdf": "https://arxiv.org/abs/1503.02531",
		"https://arxiv.org/pdf/2404.19756v4":   "https://arxiv.org/abs/2404.19756v4",
		"hep-th/9901001":                       "https://arxiv.org/abs/hep-th/9901001",
	}
	for in, want := range cases {
		got, err := normalizeArxiv(in)
		if err != nil || got != want {
			t.Errorf("normalizeArxiv(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "hello", "https://example.com/paper.pdf"} {
		if _, err := normalizeArxiv(bad); err == nil {
			t.Errorf("normalizeArxiv(%q) should fail", bad)
		}
	}
}

func TestDataPathRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	if _, err := DataPath(dir, "workspaces/1/uploads/papers/a.pdf"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"../etc/passwd", "workspaces/../../x"} {
		if _, err := DataPath(dir, bad); err == nil {
			t.Errorf("DataPath(%q) should fail", bad)
		}
	}
	if got := sanitizeName(`..\..\evil name?.pdf`); filepath.Base(got) != got || got != "evil_name_.pdf" {
		t.Errorf("sanitizeName = %q", got)
	}
}
