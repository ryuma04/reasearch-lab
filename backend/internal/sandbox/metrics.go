package sandbox

// The results/metrics.json contract (Hero 2: no number without proof).
//
// Structured form (preferred):
//
//	{
//	  "schema_version": 1,
//	  "metrics":   {"test_accuracy": 0.981, "test_errors": 190},      // required, finite numbers
//	  "artifacts": [{"path": "models/student.pt", "kind": "model", "format": "torch"}],
//	  "metadata":  {"dataset": "mnist"}                               // optional, never shown as results
//	}
//
// Legacy flat form {"name": number, ...} is still accepted (nested objects are flattened with
// dots, non-numbers ignored) so earlier projects keep working; it cannot declare artifacts.
// Files in models/ are always collected as model artifacts and must load before success.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	maxMetricsBytes = 1 << 20
	maxMetricCount  = 500
	maxArtifacts    = 50
)

var (
	metricNameRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,99}$`)
	nonFiniteRe  = regexp.MustCompile(`(?:[:\[,]\s*)(-?Infinity|NaN)\b`)
	artifactKind = map[string]bool{"model": true, "figure": true, "table": true, "data": true, "log": true, "other": true}
	// ModelFormats maps a format to the extensions it is verified with.
	ModelFormats = map[string][]string{
		"torch": {".pt", ".pth"}, "joblib": {".joblib"}, "pickle": {".pkl", ".pickle"},
		"xgboost": {".json", ".ubj", ".xgb"},
	}
)

// Artifact is a validated file produced by the run.
type Artifact struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Format   string `json:"format,omitempty"`
	Size     int64  `json:"size"`
	Verified *bool  `json:"verified,omitempty"` // models only: loaded in a fresh container
	Error    string `json:"error,omitempty"`
}

// MetricsDoc is a validated metrics.json.
type MetricsDoc struct {
	Metrics   map[string]float64
	Artifacts []Artifact
	Legacy    bool
}

// ArtifactLimits bounds what a run may leave behind.
type ArtifactLimits struct {
	MaxFileBytes  int64
	MaxTotalBytes int64
}

// ParseMetrics validates the JSON document itself (no file system access).
func ParseMetrics(raw []byte, required []string) (*MetricsDoc, []artifactDecl, error) {
	if len(raw) > maxMetricsBytes {
		return nil, nil, fmt.Errorf("metrics.json is larger than %d bytes", maxMetricsBytes)
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		if m := nonFiniteRe.FindSubmatch(raw); m != nil {
			return nil, nil, fmt.Errorf("metrics.json contains a non-finite number (%s); every metric must be a finite number", m[1])
		}
		return nil, nil, fmt.Errorf("metrics.json is not a valid JSON object: %v", err)
	}
	doc := &MetricsDoc{Metrics: map[string]float64{}}
	var decls []artifactDecl

	if rawMetrics, ok := top["metrics"]; ok {
		for k := range top {
			switch k {
			case "schema_version", "metrics", "artifacts", "metadata":
			default:
				return nil, nil, fmt.Errorf("metrics.json has an unexpected top-level key %q (allowed: schema_version, metrics, artifacts, metadata)", k)
			}
		}
		var m map[string]any
		if err := json.Unmarshal(rawMetrics, &m); err != nil || m == nil {
			return nil, nil, errors.New(`"metrics" must be an object of name: number`)
		}
		if err := flattenStrict("", m, doc.Metrics); err != nil {
			return nil, nil, err
		}
		if ra, ok := top["artifacts"]; ok {
			if err := json.Unmarshal(ra, &decls); err != nil {
				return nil, nil, errors.New(`"artifacts" must be a list of {"path", "kind", "format"}`)
			}
			if len(decls) > maxArtifacts {
				return nil, nil, fmt.Errorf("too many artifacts (max %d)", maxArtifacts)
			}
		}
	} else {
		doc.Legacy = true
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		flatten("", m, doc.Metrics)
	}
	if len(doc.Metrics) == 0 {
		return nil, nil, errors.New("metrics.json contains no numeric metrics")
	}
	if len(doc.Metrics) > maxMetricCount {
		return nil, nil, fmt.Errorf("metrics.json has more than %d metrics", maxMetricCount)
	}
	for name := range doc.Metrics {
		if !metricNameRe.MatchString(name) {
			return nil, nil, fmt.Errorf("metric name %q is not allowed (letters, digits, _ . - only)", name)
		}
	}
	var missing []string
	for _, r := range required {
		if _, ok := doc.Metrics[r]; !ok && r != "" {
			missing = append(missing, r)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return nil, nil, fmt.Errorf("metrics.json is missing required metrics: %s", strings.Join(missing, ", "))
	}
	return doc, decls, nil
}

type artifactDecl struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Format string `json:"format"`
}

func flattenStrict(prefix string, m map[string]any, out map[string]float64) error {
	for k, v := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch t := v.(type) {
		case float64:
			if math.IsNaN(t) || math.IsInf(t, 0) {
				return fmt.Errorf("metric %q is not a finite number", key)
			}
			out[key] = t
		case map[string]any:
			if err := flattenStrict(key, t, out); err != nil {
				return err
			}
		case nil:
			return fmt.Errorf("metric %q is null: the code must write a measured number", key)
		default:
			return fmt.Errorf("metric %q must be a number, got %T", key, v)
		}
	}
	return nil
}

// LoadMetrics reads and validates results/metrics.json and every artifact against the files on
// disk. Model files in models/ are collected even when not declared.
func LoadMetrics(project string, required []string, lim ArtifactLimits) (*MetricsDoc, error) {
	p, err := ResolveNoSymlink(project, "results/metrics.json")
	if err != nil {
		return nil, fmt.Errorf("results/metrics.json: %v", err)
	}
	info, err := os.Lstat(p)
	if err != nil {
		return nil, errMetricsMissing
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("results/metrics.json is not a regular file")
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	doc, decls, err := ParseMetrics(raw, required)
	if err != nil {
		return nil, err
	}
	arts, err := collectArtifacts(project, decls, lim)
	if err != nil {
		return nil, err
	}
	doc.Artifacts = arts
	return doc, nil
}

var errMetricsMissing = errors.New("results/metrics.json was not written by the code")

func collectArtifacts(project string, decls []artifactDecl, lim ArtifactLimits) ([]Artifact, error) {
	out := []Artifact{}
	seen := map[string]bool{}
	var total int64
	add := func(rel, kind, format string, declared bool) error {
		if seen[rel] {
			return nil
		}
		seen[rel] = true
		full, err := ResolveNoSymlink(project, rel)
		if err != nil {
			return fmt.Errorf("artifact %s: %v", rel, err)
		}
		info, err := os.Lstat(full)
		if err != nil {
			return fmt.Errorf("artifact %s was declared in metrics.json but does not exist", rel)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("artifact %s is not a regular file", rel)
		}
		if lim.MaxFileBytes > 0 && info.Size() > lim.MaxFileBytes {
			return fmt.Errorf("artifact %s is %d MB, larger than the %d MB limit", rel, info.Size()>>20, lim.MaxFileBytes>>20)
		}
		total += info.Size()
		if lim.MaxTotalBytes > 0 && total > lim.MaxTotalBytes {
			return fmt.Errorf("artifacts are larger than the %d MB total limit", lim.MaxTotalBytes>>20)
		}
		if kind == "" {
			kind = "other"
			if strings.HasPrefix(rel, "models/") {
				kind = "model"
			}
		}
		if !artifactKind[kind] {
			return fmt.Errorf("artifact %s has unknown kind %q", rel, kind)
		}
		if kind == "model" {
			format, err = modelFormat(rel, format)
			if err != nil {
				if !declared {
					kind, format = "other", "" // an undeclared helper file in models/ is kept but not verified
				} else {
					return err
				}
			}
		}
		out = append(out, Artifact{Path: rel, Kind: kind, Format: format, Size: info.Size()})
		return nil
	}
	for _, d := range decls {
		rel, err := ArtifactRel(d.Path)
		if err != nil {
			return nil, fmt.Errorf("unexpected artifact path in metrics.json: %v", err)
		}
		if err := add(rel, d.Kind, d.Format, true); err != nil {
			return nil, err
		}
	}
	// Everything saved in the dedicated model directory.
	modelsDir, err := ResolveNoSymlink(project, "models")
	if err != nil {
		return nil, err
	}
	if st, err := os.Lstat(modelsDir); err == nil && st.IsDir() {
		var walkErr error
		_ = filepath.WalkDir(modelsDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || p == modelsDir {
				return nil
			}
			relOS, _ := filepath.Rel(project, p)
			rel := filepath.ToSlash(relOS)
			if d.Type()&fs.ModeSymlink != 0 {
				walkErr = fmt.Errorf("artifact %s is a symbolic link", rel)
				return filepath.SkipAll
			}
			if d.IsDir() {
				return nil
			}
			if _, err := ArtifactRel(rel); err != nil {
				return nil // odd names (hidden files) are ignored, never served
			}
			if err := add(rel, "", "", false); err != nil {
				walkErr = err
				return filepath.SkipAll
			}
			return nil
		})
		if walkErr != nil {
			return nil, walkErr
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func modelFormat(rel, format string) (string, error) {
	ext := strings.ToLower(path.Ext(rel))
	if format != "" {
		exts, ok := ModelFormats[format]
		if !ok {
			return "", fmt.Errorf("model %s has unsupported format %q (supported: torch, joblib, pickle, xgboost)", rel, format)
		}
		if !contains(exts, ext) {
			return "", fmt.Errorf("model %s: extension %s does not match format %s", rel, ext, format)
		}
		return format, nil
	}
	for f, exts := range ModelFormats {
		if f != "xgboost" && contains(exts, ext) {
			return f, nil
		}
	}
	return "", fmt.Errorf("model %s: cannot tell how to load %s files; declare its format (torch, joblib, pickle, xgboost)", rel, ext)
}

// verifyScript loads each model in a fresh offline container. The list comes from LAB_VERIFY.
const verifyScript = `import json, os, sys
items = json.loads(os.environ["LAB_VERIFY"])
bad = 0
for it in items:
    p, fmt = it["path"], it["format"]
    try:
        if fmt == "torch":
            import torch
            try:
                obj = torch.load(p, map_location="cpu", weights_only=True)
            except Exception:
                obj = torch.load(p, map_location="cpu", weights_only=False)
        elif fmt == "joblib":
            import joblib
            obj = joblib.load(p)
        elif fmt == "pickle":
            import pickle
            with open(p, "rb") as f:
                obj = pickle.load(f)
        elif fmt == "xgboost":
            import xgboost
            obj = xgboost.Booster()
            obj.load_model(p)
        else:
            raise ValueError("unsupported model format " + fmt)
        print("OK " + p + ": loaded " + type(obj).__name__, flush=True)
    except Exception as e:
        bad += 1
        print("FAIL " + p + ": " + type(e).__name__ + ": " + str(e)[:300], flush=True)
sys.exit(1 if bad else 0)
`
