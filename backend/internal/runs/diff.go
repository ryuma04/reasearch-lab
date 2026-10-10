package runs

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxDiffFileBytes = 200 << 10
	maxDiffLines     = 2500
)

// lineDiff is a line-based diff (longest common subsequence). Unchanged stretches longer than 2*ctx lines are
// collapsed to a marker so a one-line change in a long file stays readable. Prefixes: "  " same, "- " old, "+ " new.
func lineDiff(a, b []string, ctx int) []string {
	n, m := len(a), len(b)
	dp := make([][]int32, n+1)
	for i := range dp {
		dp[i] = make([]int32, m+1)
	}
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	var ops []string
	i, j := 0, 0
	for i < n && j < m {
		switch {
		case a[i] == b[j]:
			ops = append(ops, "  "+a[i])
			i++
			j++
		case dp[i+1][j] >= dp[i][j+1]:
			ops = append(ops, "- "+a[i])
			i++
		default:
			ops = append(ops, "+ "+b[j])
			j++
		}
	}
	for ; i < n; i++ {
		ops = append(ops, "- "+a[i])
	}
	for ; j < m; j++ {
		ops = append(ops, "+ "+b[j])
	}
	// collapse long unchanged runs
	var out []string
	for k := 0; k < len(ops); {
		if strings.HasPrefix(ops[k], "  ") {
			e := k
			for e < len(ops) && strings.HasPrefix(ops[e], "  ") {
				e++
			}
			if run := e - k; run > 2*ctx && k > 0 && e < len(ops) {
				out = append(out, ops[k:k+ctx]...)
				out = append(out, fmt.Sprintf("@@ %d unchanged lines @@", run-2*ctx))
				out = append(out, ops[e-ctx:e]...)
			} else if k == 0 && run > ctx && e < len(ops) {
				out = append(out, fmt.Sprintf("@@ %d unchanged lines @@", run-ctx))
				out = append(out, ops[e-ctx:e]...)
			} else if e == len(ops) && run > ctx && k > 0 {
				out = append(out, ops[k:k+ctx]...)
				out = append(out, fmt.Sprintf("@@ %d unchanged lines @@", run-ctx))
			} else {
				out = append(out, ops[k:e]...)
			}
			k = e
			continue
		}
		out = append(out, ops[k])
		k++
	}
	return out
}

// FileDiff is one file that differs between two versions.
type FileDiff struct {
	Path    string   `json:"path"`
	Status  string   `json:"status"` // added | removed | modified
	Added   int      `json:"added"`
	Removed int      `json:"removed"`
	Diff    []string `json:"diff"`
	Note    string   `json:"note,omitempty"`
}

// codeFiles reads the files that make up a version's implementation. Symbolic links are never followed (code that
// ran in the sandbox could have planted one), caches and oversized files are skipped, and the second return value
// lists what was skipped so the comparison never silently omits a file.
func codeFiles(root string) (files map[string]string, skipped map[string]string) {
	files, skipped = map[string]string{}, map[string]string{}
	add := func(path string) {
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return
		}
		rel = filepath.ToSlash(rel)
		fi, err := os.Lstat(path)
		if err != nil || fi.Mode()&os.ModeSymlink != 0 || !fi.Mode().IsRegular() {
			return
		}
		if fi.Size() > maxDiffFileBytes {
			skipped[rel] = "larger than 200 KB"
			return
		}
		raw, err := os.ReadFile(path)
		if err != nil || strings.IndexByte(string(raw), 0) >= 0 {
			skipped[rel] = "binary file"
			return
		}
		files[rel] = string(raw)
	}
	for _, dir := range []string{"src", "configs", "tests"} {
		_ = filepath.WalkDir(filepath.Join(root, dir), func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if d.Name() == "__pycache__" || d.Type()&os.ModeSymlink != 0 {
					return filepath.SkipDir
				}
				return nil
			}
			add(p)
			return nil
		})
	}
	for _, f := range []string{"requirements.txt", "Dockerfile"} {
		add(filepath.Join(root, f))
	}
	return files, skipped
}

// diffTrees compares two versions' code and returns one entry per file that differs, sorted by path.
func diffTrees(oldRoot, newRoot string) ([]FileDiff, map[string]string) {
	a, sa := codeFiles(oldRoot)
	b, sb := codeFiles(newRoot)
	for k, v := range sb {
		sa[k] = v
	}
	paths := map[string]bool{}
	for p := range a {
		paths[p] = true
	}
	for p := range b {
		paths[p] = true
	}
	sorted := make([]string, 0, len(paths))
	for p := range paths {
		sorted = append(sorted, p)
	}
	sort.Strings(sorted)
	var out []FileDiff
	for _, p := range sorted {
		ao, inA := a[p]
		bo, inB := b[p]
		if inA && inB && ao == bo {
			continue
		}
		fd := FileDiff{Path: p, Status: "modified"}
		al, bl := splitLines(ao), splitLines(bo)
		switch {
		case !inA:
			fd.Status = "added"
		case !inB:
			fd.Status = "removed"
		}
		if len(al) > maxDiffLines || len(bl) > maxDiffLines {
			fd.Note = "too many lines for an inline diff"
		} else {
			fd.Diff = lineDiff(al, bl, 3)
			for _, l := range fd.Diff {
				if strings.HasPrefix(l, "+ ") {
					fd.Added++
				} else if strings.HasPrefix(l, "- ") {
					fd.Removed++
				}
			}
		}
		out = append(out, fd)
	}
	return out, sa
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(strings.ReplaceAll(s, "\r\n", "\n"), "\n"), "\n")
}
