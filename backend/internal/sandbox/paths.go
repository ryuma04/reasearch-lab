package sandbox

// Path rules for everything the API reads from or writes into a run's project folder.
// Sandboxed code can write files (including symlinks) into results/ and models/, so every
// host-side access refuses symlinks, and every API path is a plain relative name.

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	ErrBadPath  = errors.New("invalid path")
	ErrSymlink  = errors.New("path contains a symbolic link")
	segmentRe   = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,99}$`)
	reservedRe  = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$`)
	editableExt = map[string]bool{".py": true, ".yaml": true, ".yml": true, ".json": true, ".txt": true, ".md": true,
		".cfg": true, ".toml": true, ".ini": true}
)

const (
	maxPathLen  = 255
	maxPathSegs = 8
	// MaxSourceBytes is the largest source file the editor may save.
	MaxSourceBytes = 1 << 20
)

// EditableDirs are the folders the researcher may edit (src/, configs/, tests/), plus requirements.txt.
var EditableDirs = []string{"src", "configs", "tests"}

// ArtifactDirs are the only folders results and model artifacts may come from.
var ArtifactDirs = []string{"results", "models"}

// CleanRel validates a project-relative path given by a client: forward slashes, no empty, "."
// or ".." segments, no hidden files, no drive letters, every segment a plain file name.
func CleanRel(p string) (string, error) {
	if p == "" || len(p) > maxPathLen || strings.ContainsAny(p, "\\:\x00") || strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("%w: %q", ErrBadPath, p)
	}
	segs := strings.Split(p, "/")
	if len(segs) > maxPathSegs {
		return "", fmt.Errorf("%w: too deep", ErrBadPath)
	}
	for _, s := range segs {
		if !segmentRe.MatchString(s) || reservedRe.MatchString(s) || strings.HasSuffix(s, ".") {
			return "", fmt.Errorf("%w: %q", ErrBadPath, p)
		}
	}
	if path.Clean(p) != p {
		return "", fmt.Errorf("%w: %q", ErrBadPath, p)
	}
	return p, nil
}

// EditablePath accepts only source files the researcher may edit and save.
func EditablePath(p string) (string, error) {
	p, err := CleanRel(p)
	if err != nil {
		return "", err
	}
	if p == "requirements.txt" {
		return p, nil
	}
	top, _, nested := strings.Cut(p, "/")
	if !nested || !contains(EditableDirs, top) {
		return "", fmt.Errorf("%w: only files in src/, configs/, tests/ and requirements.txt can be edited", ErrBadPath)
	}
	if !editableExt[strings.ToLower(path.Ext(p))] {
		return "", fmt.Errorf("%w: file type %q cannot be edited here", ErrBadPath, path.Ext(p))
	}
	return p, nil
}

// EntrypointPath accepts the Python script to execute: a .py file under src/ or tests/.
func EntrypointPath(p string) (string, error) {
	p, err := CleanRel(p)
	if err != nil {
		return "", err
	}
	top, _, nested := strings.Cut(p, "/")
	if !nested || (top != "src" && top != "tests") || path.Ext(p) != ".py" {
		return "", fmt.Errorf("%w: the entrypoint must be a .py file in src/ or tests/", ErrBadPath)
	}
	return p, nil
}

// ArtifactRel accepts an artifact path declared in metrics.json: under results/ or models/.
func ArtifactRel(p string) (string, error) {
	p, err := CleanRel(strings.TrimPrefix(p, "./"))
	if err != nil {
		return "", err
	}
	top, _, nested := strings.Cut(p, "/")
	if !nested || !contains(ArtifactDirs, top) {
		return "", fmt.Errorf("%w: artifacts must be inside results/ or models/: %q", ErrBadPath, p)
	}
	return p, nil
}

// ResolveNoSymlink joins root and a validated relative path, refusing any existing component
// that is a symbolic link (or other reparse point), so sandbox-written links can never make the
// host read or write outside the project folder.
func ResolveNoSymlink(root, rel string) (string, error) {
	cur := filepath.Clean(root)
	for _, seg := range strings.Split(rel, "/") {
		cur = filepath.Join(cur, seg)
		info, err := os.Lstat(cur)
		if errors.Is(err, fs.ErrNotExist) {
			return filepath.Join(root, filepath.FromSlash(rel)), nil
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&fs.ModeSymlink != 0 || info.Mode()&fs.ModeIrregular != 0 {
			return "", fmt.Errorf("%w: %s", ErrSymlink, rel)
		}
	}
	return cur, nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
