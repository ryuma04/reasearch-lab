package githubpush

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ryuma04/tapu-sena/services/api/internal/ghapi"
	"github.com/ryuma04/tapu-sena/services/api/internal/sandbox"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
)

const maxPushFileBytes = 50 << 20

type Bundle struct {
	Files    map[string][]byte
	Stage    map[string]int // path -> commit stage (0 research, 1 implementation, 2 tests and results)
	Skipped  []string
	WhatIfs  []ghapi.CommitSpec
	Repo     string
	Branch   string
	Claimed  int
	Matched  int
	Duration string
}

var stageMessages = []string{"Add research brief and claims", "Add implementation", "Add tests and results"}

type scoreRow struct {
	Claim struct {
		Description string  `json:"description"`
		Value       float64 `json:"value"`
		Unit        string  `json:"unit"`
		Page        *int    `json:"page"`
		TableRef    string  `json:"table_ref"`
	} `json:"claim"`
	Status string `json:"status"`
	Ours   *struct {
		Value       float64 `json:"value"`
		RunID       int64   `json:"run_id"`
		CodeVersion string  `json:"code_version"`
		LogFile     string  `json:"log_file"`
		LogLine     *int    `json:"log_line"`
	} `json:"ours"`
	Difference  *float64 `json:"difference"`
	Explanation string   `json:"explanation"`
}

// BuildBundle collects the run's project into the repository layout of Section 17.3.
// All numbers in generated files come from the database (Hero 2).
func (s *Service) BuildBundle(ctx context.Context, run *store.Run, ws *store.Workspace, repo, branch string) (*Bundle, error) {
	b := &Bundle{Files: map[string][]byte{}, Stage: map[string]int{}, Repo: repo, Branch: branch}
	root := filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(run.WorkspaceID, run.ID)))
	if _, err := os.Stat(root); err != nil {
		return nil, fmt.Errorf("run has no project folder yet")
	}

	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		top := strings.Split(rel, "/")[0]
		if d.IsDir() {
			switch top {
			case ".git", ".pydeps", ".cache", "data", "__pycache__", ".pytest_cache", "models", "checkpoints":
				if rel == top {
					if top == "data" || top == "models" || top == "checkpoints" {
						b.Skipped = append(b.Skipped, rel+"/ (datasets and model files are not pushed; use src/download_data.py)")
					}
					return filepath.SkipDir
				}
			}
			if strings.HasSuffix(rel, "__pycache__") {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.Size() > maxPushFileBytes {
			b.Skipped = append(b.Skipped, fmt.Sprintf("%s (%.0f MB, over the 50 MB limit)", rel, float64(info.Size())/(1<<20)))
			return nil
		}
		ext := strings.ToLower(filepath.Ext(rel))
		if ext == ".pt" || ext == ".pth" || ext == ".ckpt" || ext == ".pyc" {
			b.Skipped = append(b.Skipped, rel+" (model/binary file)")
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		b.add(rel, data, stageFor(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Generated files.
	claims, err := s.store.QueryJSON(ctx, `
		SELECT c.id, c.metric_name, c.description, c.value, c.unit, c.higher_is_better, c.tolerance,
			c.page, c.table_ref, c.condition, c.quote, p.title AS paper
		FROM claims c JOIN papers p ON p.id=c.paper_id WHERE p.workspace_id=$1 ORDER BY c.id`, run.WorkspaceID)
	if err != nil {
		return nil, err
	}
	b.add("paper/claims.json", pretty(claims), 0)

	mp, err := s.store.ResearchMap(ctx, run.ID)
	if err == nil {
		b.add("research/research-map.json", pretty(mp), 0)
	}

	scRaw, err := s.store.Scorecard(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	var rows []scoreRow
	_ = json.Unmarshal(scRaw, &rows)
	b.add("results/scorecard.md", []byte(scorecardMarkdown(rows)), 2)

	gapRaw, err := s.store.GapAnalyses(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	b.add("results/gap-analysis.md", []byte(gapMarkdown(gapRaw)), 2)

	if _, ok := b.Files["Dockerfile"]; !ok {
		b.add("Dockerfile", []byte(defaultDockerfile), 1)
	}
	if _, ok := b.Files["notebook.ipynb"]; !ok {
		b.add("notebook.ipynb", notebook(), 1)
	}
	b.add(".gitignore", []byte("data/\n.pydeps/\n.cache/\n__pycache__/\n*.pt\n*.pth\n"), 1)

	b.Claimed = len(rows)
	for _, r := range rows {
		if r.Status == "match" {
			b.Matched++
		}
	}
	if run.StartedAt != nil && run.FinishedAt != nil {
		b.Duration = fmt.Sprintf("%.0f minutes", math.Ceil(run.FinishedAt.Sub(*run.StartedAt).Minutes()))
	}
	b.add("README.md", []byte(s.readme(ws, run, rows, b)), 2)

	// What-if branches: each finished branch is its own git branch.
	children, err := s.store.ChildRuns(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	brRaw, _ := s.store.WhatIfBranches(ctx, run.ID)
	var branches []struct {
		Question   string          `json:"question"`
		Label      string          `json:"label"`
		Status     string          `json:"status"`
		ChildRunID *int64          `json:"child_run_id"`
		Settings   json.RawMessage `json:"settings_change"`
		Result     *struct {
			Name  string  `json:"name"`
			Value float64 `json:"value"`
		} `json:"result"`
	}
	_ = json.Unmarshal(brRaw, &branches)
	for _, br := range branches {
		if br.ChildRunID == nil || (br.Status != "done" && br.Status != "stopped_early") {
			continue
		}
		var child *store.Run
		for _, c := range children {
			if c.ID == *br.ChildRunID {
				child = c
			}
		}
		if child == nil {
			continue
		}
		croot := filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(child.WorkspaceID, child.ID)))
		slug := sanitizeBranch(br.Label)
		files := []ghapi.File{}
		for _, rel := range []string{"configs/config.yaml", "configs/config.json", "results/metrics.json"} {
			if data, err := os.ReadFile(filepath.Join(croot, filepath.FromSlash(rel))); err == nil {
				files = append(files, ghapi.File{Path: "whatif/" + slug + "/" + rel, Content: data})
			}
		}
		logs, _ := filepath.Glob(filepath.Join(croot, "logs", "execute-*.log"))
		for _, l := range logs {
			if data, err := os.ReadFile(l); err == nil && len(data) < maxPushFileBytes {
				files = append(files, ghapi.File{Path: "whatif/" + slug + "/logs/" + filepath.Base(l), Content: data})
			}
		}
		summary := fmt.Sprintf("# What-if: %s\n\nBranch: `%s`\n\nStatus: %s\n\nSettings change:\n\n```json\n%s\n```\n",
			br.Question, br.Label, br.Status, string(pretty(br.Settings)))
		if br.Result != nil {
			summary += fmt.Sprintf("\nResult (from run #%d metrics.json): `%s = %s`\n", child.ID, br.Result.Name, trimFloat(br.Result.Value))
		}
		files = append(files, ghapi.File{Path: "whatif/" + slug + "/README.md", Content: []byte(summary)})
		for _, f := range files {
			b.Files[f.Path] = f.Content // included in the secret scan
		}
		b.WhatIfs = append(b.WhatIfs, ghapi.CommitSpec{Branch: "whatif/" + slug, Message: "Add what-if: " + shorten(br.Question, 60) + " (" + br.Label + ")", Files: files})
	}
	sort.Strings(b.Skipped)
	return b, nil
}

func (b *Bundle) add(path string, data []byte, stage int) {
	b.Files[path] = data
	b.Stage[path] = stage
}

func stageFor(rel string) int {
	switch strings.Split(rel, "/")[0] {
	case "paper", "research":
		return 0
	case "src", "configs", "requirements.txt", "Dockerfile", "notebook.ipynb", "environment.yml", "R":
		return 1
	}
	return 2
}

// Commits groups bundle files into one meaningful commit per stage, then what-if branches.
func (b *Bundle) Commits(branch string) []ghapi.CommitSpec {
	stages := make([][]ghapi.File, len(stageMessages))
	paths := make([]string, 0, len(b.Stage))
	for p := range b.Stage {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		st := b.Stage[p]
		stages[st] = append(stages[st], ghapi.File{Path: p, Content: b.Files[p]})
	}
	var out []ghapi.CommitSpec
	for i, files := range stages {
		if len(files) > 0 {
			out = append(out, ghapi.CommitSpec{Branch: branch, Message: stageMessages[i], Files: files})
		}
	}
	for _, w := range b.WhatIfs {
		w.FromBranch = branch
		out = append(out, w)
	}
	return out
}

func (s *Service) readme(ws *store.Workspace, run *store.Run, rows []scoreRow, b *Bundle) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "# %s\n\n", ws.Title)
	badge := fmt.Sprintf("%d of %d claims reproduced on CPU", b.Matched, b.Claimed)
	if b.Duration != "" {
		badge += " in " + b.Duration
	}
	fmt.Fprintf(&sb, "![reproducibility](https://img.shields.io/badge/reproduced-%s-%s)\n\n",
		strings.ReplaceAll(strings.ReplaceAll(badge, " ", "%20"), "-", "--"), badgeColor(b.Matched, b.Claimed))
	if b.Repo != "" {
		fmt.Fprintf(&sb, "[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/%s/blob/%s/notebook.ipynb)\n\n", b.Repo, b.Branch)
	}
	fmt.Fprintf(&sb, "Automatic reproduction produced by an evolving team of AI agents (run #%d, budget: %s, code version `%s`).\n\n",
		run.ID, run.ComputeBudget, run.GitCommit)
	sb.WriteString("**Every number below was written by code that ran in a sandbox** (`results/metrics.json`) and links to the exact run, code version and log line.\n\n")
	sb.WriteString("## Claim Scorecard\n\n")
	sb.WriteString(scorecardTable(rows))
	sb.WriteString("\nSee `results/scorecard.md` for proof details and `results/gap-analysis.md` for why results differ.\n\n")
	sb.WriteString("## Repository layout\n\n```\npaper/claims.json       every claim with page and table\nresearch/brief.md       Research Brief\nsrc/                    implementation\nconfigs/                every setting, labelled with its source\ntests/                  correctness tests and claim tests\nresults/                metrics.json, scorecard, gap analysis\nlogs/                   full run logs\nnotebook.ipynb          one-click re-run on Colab\n```\n\n")
	sb.WriteString("## Re-run\n\n```bash\npip install -r requirements.txt\npython src/download_data.py   # if present\npython src/train.py\npytest tests\n```\n")
	if len(b.WhatIfs) > 0 {
		sb.WriteString("\n## What-if branches\n\n")
		for _, w := range b.WhatIfs {
			fmt.Fprintf(&sb, "- `%s`: %s\n", w.Branch, w.Message)
		}
	}
	if len(b.Skipped) > 0 {
		sb.WriteString("\n## Not pushed\n\n")
		for _, sk := range b.Skipped {
			fmt.Fprintf(&sb, "- %s\n", sk)
		}
	}
	return sb.String()
}

func badgeColor(m, n int) string {
	switch {
	case n == 0:
		return "lightgrey"
	case m == n:
		return "brightgreen"
	case m > 0:
		return "yellow"
	}
	return "orange"
}

func scorecardTable(rows []scoreRow) string {
	if len(rows) == 0 {
		return "_No claims were scored._\n"
	}
	var sb strings.Builder
	sb.WriteString("| Claim | Paper | Ours | Difference | Status |\n|---|---|---|---|---|\n")
	for _, r := range rows {
		ours, diff := "—", "—"
		if r.Ours != nil {
			ours = trimFloat(r.Ours.Value)
		}
		if r.Difference != nil {
			diff = trimFloat(*r.Difference)
		}
		src := r.Claim.TableRef
		if r.Claim.Page != nil {
			src = strings.TrimSpace(fmt.Sprintf("%s p.%d", src, *r.Claim.Page))
		}
		fmt.Fprintf(&sb, "| %s (%s) | %s %s | %s | %s | %s |\n", r.Claim.Description, src, trimFloat(r.Claim.Value), r.Claim.Unit, ours, diff, strings.ToUpper(r.Status))
	}
	return sb.String()
}

func scorecardMarkdown(rows []scoreRow) string {
	var sb strings.Builder
	sb.WriteString("# Claim Scorecard\n\n")
	sb.WriteString(scorecardTable(rows))
	sb.WriteString("\n## Proof\n\n")
	for _, r := range rows {
		if r.Ours == nil {
			fmt.Fprintf(&sb, "- **%s**: no metric was produced.\n", r.Claim.Description)
			continue
		}
		line := "?"
		if r.Ours.LogLine != nil {
			line = fmt.Sprint(*r.Ours.LogLine)
		}
		fmt.Fprintf(&sb, "- **%s**: from run #%d · code `%s` · `%s` line %s\n", r.Claim.Description, r.Ours.RunID, r.Ours.CodeVersion, r.Ours.LogFile, line)
		if r.Explanation != "" {
			fmt.Fprintf(&sb, "  - %s\n", r.Explanation)
		}
	}
	return sb.String()
}

func gapMarkdown(raw json.RawMessage) string {
	var items []struct {
		Claim       string `json:"claim"`
		Explanation string `json:"explanation"`
		Differences []struct {
			Setting string `json:"setting"`
			Ours    string `json:"ours"`
			Paper   string `json:"paper"`
			Reason  string `json:"reason"`
		} `json:"differences"`
	}
	_ = json.Unmarshal(raw, &items)
	var sb strings.Builder
	sb.WriteString("# Gap analysis\n\n")
	if len(items) == 0 {
		sb.WriteString("All claims matched, or no Gap Detective analysis was needed.\n")
		return sb.String()
	}
	for _, it := range items {
		fmt.Fprintf(&sb, "## %s\n\n%s\n\n", it.Claim, it.Explanation)
		if len(it.Differences) > 0 {
			sb.WriteString("| Setting | Ours | Paper | Note |\n|---|---|---|---|\n")
			for _, d := range it.Differences {
				fmt.Fprintf(&sb, "| %s | %s | %s | %s |\n", d.Setting, d.Ours, d.Paper, d.Reason)
			}
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func pretty(raw json.RawMessage) []byte {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return raw
	}
	out, _ := json.MarshalIndent(v, "", "  ")
	return append(out, '\n')
}

func notebook() []byte {
	cell := func(kind string, src ...string) map[string]any {
		c := map[string]any{"cell_type": kind, "metadata": map[string]any{}, "source": src}
		if kind == "code" {
			c["outputs"] = []any{}
			c["execution_count"] = nil
		}
		return c
	}
	nb := map[string]any{
		"nbformat": 4, "nbformat_minor": 5,
		"metadata": map[string]any{"kernelspec": map[string]any{"name": "python3", "display_name": "Python 3"}},
		"cells": []any{
			cell("markdown", "# Re-run this reproduction\n", "Runs the same code and tests that produced `results/metrics.json`."),
			cell("code", "import os, subprocess\n", "if not os.path.exists('src'):\n", "    raise SystemExit('Clone the repository first (File > Open from GitHub in Colab).')"),
			cell("code", "!pip install -q -r requirements.txt"),
			cell("code", "!test -f src/download_data.py && python src/download_data.py || true"),
			cell("code", "!python src/train.py"),
			cell("code", "!cat results/metrics.json\n", "!pytest -q tests"),
		},
	}
	out, _ := json.MarshalIndent(nb, "", " ")
	return out
}

const defaultDockerfile = `FROM python:3.11-slim
WORKDIR /work
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision || true \
 && pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["bash", "-c", "python src/train.py && pytest -q tests"]
`

func sanitizeBranch(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var sb strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '.':
			sb.WriteRune(r)
		default:
			sb.WriteRune('-')
		}
	}
	out := strings.Trim(sb.String(), "-.")
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	if out == "" {
		out = "branch"
	}
	if len(out) > 50 {
		out = out[:50]
	}
	return out
}

func trimFloat(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return fmt.Sprintf("%d", int64(v))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.4f", v), "0"), ".")
}

func shorten(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
