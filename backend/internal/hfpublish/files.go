// Package hfpublish publishes a run's verified model to the Hugging Face Hub. Go decides what may
// be uploaded (validated files only, secrets and datasets excluded), writes the model card from
// database facts and records the publication; the Python agent worker performs the upload with
// the official huggingface_hub client and reports the Hub's confirmed result back.
package hfpublish

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/githubpush"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
)

// FileItem is one file that will be uploaded, fixed when the researcher confirms.
type FileItem struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
	Kind     string `json:"kind"` // model | metrics | config | requirements | code
	Required bool   `json:"required"`
}

// Excluded is a project file that is not uploaded, with the reason.
type Excluded struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// Selection is the result of choosing files for a publication.
type Selection struct {
	Files    []FileItem `json:"files"`
	Excluded []Excluded `json:"excluded"`
	Blockers []string   `json:"blockers"`
}

var skipDirs = map[string]string{
	"data": "dataset files are not uploaded", "logs": "run logs are not uploaded",
	".cache": "temporary files", ".pydeps": "installed dependencies", "__pycache__": "temporary files",
	".pytest_cache": "temporary files", "tests": "tests are not part of the model", "research": "research notes are not part of the model",
}

// Select chooses the files to publish: the models that were verified to load by the source
// execution, its validated metrics.json, the config and requirements, and (optionally) the source
// code. Everything else is listed as excluded. Text files are scanned for secrets.
func Select(ctx context.Context, project string, artifacts []sandbox.Artifact, includeCode bool, maxFile int64, gitleaksBin string) (*Selection, error) {
	sel := &Selection{Files: []FileItem{}, Excluded: []Excluded{}, Blockers: []string{}}
	verified := map[string]bool{}
	for _, a := range artifacts {
		if a.Kind == "model" && a.Verified != nil && *a.Verified {
			verified[a.Path] = true
		}
	}
	err := filepath.WalkDir(project, func(p string, d fs.DirEntry, err error) error {
		if err != nil || p == project {
			return nil
		}
		relOS, _ := filepath.Rel(project, p)
		rel := filepath.ToSlash(relOS)
		top, _, nested := strings.Cut(rel, "/")
		if d.IsDir() {
			if reason, ok := skipDirs[d.Name()]; ok {
				sel.Excluded = append(sel.Excluded, Excluded{rel + "/", reason})
				return filepath.SkipDir
			}
			if strings.HasPrefix(d.Name(), ".") {
				sel.Excluded = append(sel.Excluded, Excluded{rel + "/", "hidden folder"})
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			sel.Excluded = append(sel.Excluded, Excluded{rel, "not a regular file (for example a link)"})
			return nil
		}
		if _, err := sandbox.CleanRel(rel); err != nil {
			sel.Excluded = append(sel.Excluded, Excluded{rel, "hidden or unusual file name"})
			return nil
		}
		kind, required, reason := classify(rel, top, nested, verified, includeCode)
		if kind == "" {
			sel.Excluded = append(sel.Excluded, Excluded{rel, reason})
			return nil
		}
		full, err := sandbox.ResolveNoSymlink(project, rel)
		if err != nil {
			sel.Excluded = append(sel.Excluded, Excluded{rel, "path contains a link"})
			return nil
		}
		info, err := os.Lstat(full)
		if err != nil {
			return nil
		}
		if info.Size() == 0 && kind != "model" {
			sel.Excluded = append(sel.Excluded, Excluded{rel, "empty file"})
			return nil
		}
		if maxFile > 0 && info.Size() > maxFile {
			sel.Excluded = append(sel.Excluded, Excluded{rel, fmt.Sprintf("larger than the %d MB limit", maxFile>>20)})
			if required {
				sel.Blockers = append(sel.Blockers, rel+" is larger than the upload limit")
			}
			return nil
		}
		sum, err := fileSHA256(full)
		if err != nil {
			return err
		}
		sel.Files = append(sel.Files, FileItem{Path: rel, Size: info.Size(), SHA256: sum, Kind: kind, Required: required})
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Secret scan over every text file that would be uploaded (models are binary).
	texts := map[string][]byte{}
	for _, f := range sel.Files {
		if f.Kind != "model" {
			if b, err := os.ReadFile(filepath.Join(project, filepath.FromSlash(f.Path))); err == nil {
				texts[f.Path] = b
			}
		}
	}
	if len(texts) > 0 {
		res, err := githubpush.Scan(ctx, gitleaksBin, texts)
		if err != nil {
			return nil, fmt.Errorf("secret scan failed: %w", err)
		}
		flagged := map[string]string{}
		for _, fd := range res.Findings {
			if _, seen := flagged[fd.File]; !seen {
				flagged[fd.File] = fmt.Sprintf("possible secret (%s) on line %d", fd.Rule, fd.Line)
			}
		}
		kept := sel.Files[:0]
		for _, f := range sel.Files {
			if why, bad := flagged[f.Path]; bad {
				sel.Excluded = append(sel.Excluded, Excluded{f.Path, why})
				if f.Required {
					sel.Blockers = append(sel.Blockers, f.Path+": "+why+"; remove it before publishing")
				}
				continue
			}
			kept = append(kept, f)
		}
		sel.Files = kept
	}

	hasModel, hasMetrics := false, false
	for _, f := range sel.Files {
		hasModel = hasModel || f.Kind == "model"
		hasMetrics = hasMetrics || f.Kind == "metrics"
	}
	if !hasModel {
		sel.Blockers = append(sel.Blockers, "no model file that was verified to load: run the experiment so it saves its model in models/")
	}
	if !hasMetrics {
		sel.Blockers = append(sel.Blockers, "results/metrics.json from the verified run is missing")
	}
	sort.Slice(sel.Files, func(i, j int) bool { return kindRank(sel.Files[i].Kind) < kindRank(sel.Files[j].Kind) || kindRank(sel.Files[i].Kind) == kindRank(sel.Files[j].Kind) && sel.Files[i].Path < sel.Files[j].Path })
	sort.Slice(sel.Excluded, func(i, j int) bool { return sel.Excluded[i].Path < sel.Excluded[j].Path })
	return sel, nil
}

func kindRank(k string) int {
	return map[string]int{"model": 0, "metrics": 1, "config": 2, "requirements": 3, "code": 4}[k]
}

func classify(rel, top string, nested bool, verified map[string]bool, includeCode bool) (kind string, required bool, reason string) {
	ext := strings.ToLower(path.Ext(rel))
	switch {
	case top == "models" && nested:
		if verified[rel] {
			return "model", true, ""
		}
		return "", false, "this model file was not verified to load by the run"
	case rel == "results/metrics.json":
		return "metrics", true, ""
	case top == "results":
		return "", false, "other result files are not part of the model"
	case top == "configs" && nested && (ext == ".yaml" || ext == ".yml" || ext == ".json"):
		return "config", true, ""
	case rel == "requirements.txt":
		return "requirements", true, ""
	case top == "src" && nested && ext == ".py":
		if includeCode {
			return "code", false, ""
		}
		return "", false, "source code is not included (turn on Include code to add it)"
	case !nested && (ext == ".env" || strings.HasPrefix(rel, ".env")):
		return "", false, "environment file (may contain secrets)"
	}
	return "", false, "not needed by the model"
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

var repoPartRe = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$`)

// ValidateRepoName accepts "name" or "owner/name" in the Hub's naming rules.
func ValidateRepoName(s string) (string, error) {
	s = strings.TrimSpace(s)
	parts := strings.Split(s, "/")
	if s == "" || len(parts) > 2 {
		return "", fmt.Errorf("use a repository name like my-model or owner/my-model")
	}
	for _, p := range parts {
		if !repoPartRe.MatchString(p) || strings.Contains(p, "--") || strings.Contains(p, "..") {
			return "", fmt.Errorf("%q is not a valid Hugging Face name: use letters, digits, '-', '_' or '.', up to 96 characters", p)
		}
	}
	return s, nil
}
