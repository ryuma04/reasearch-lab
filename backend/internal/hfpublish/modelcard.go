package hfpublish

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// CardInfo holds only facts recorded by the app. Anything missing is written as "Not recorded".
type CardInfo struct {
	RepoID      string
	Title       string // workspace title
	RunID       int64
	ExecID      int64
	CodeVersion string
	FinishedAt  *time.Time
	Papers      []CardPaper
	Settings    []CardSetting
	Metrics     []CardMetric // measured by the source execution (results/metrics.json)
	Claims      []CardClaim  // reported by the paper
	Files       []FileItem
}

type CardPaper struct{ Title, ArxivID string }
type CardSetting struct{ Name, Value, Source, SourceRef string }
type CardMetric struct {
	Name  string
	Value float64
}
type CardClaim struct {
	MetricName, Description string
	Value                   float64
	Page                    *int
}

var sourceLabel = map[string]string{
	"paper": "from the paper", "official_code": "from the official code", "assumption": "our assumption",
	"compute_change": "changed to fit compute", "researcher": "set by the researcher",
}

func num(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return fmt.Sprintf("%d", int64(v))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", v), "0"), ".")
}

func mdCell(s string) string {
	return strings.NewReplacer("|", "\\|", "\n", " ", "\r", " ").Replace(strings.TrimSpace(s))
}

// libraryFor names the library only when the saved model format says it unambiguously.
func libraryFor(files []FileItem) string {
	for _, f := range files {
		if f.Kind != "model" {
			continue
		}
		switch {
		case strings.HasSuffix(f.Path, ".pt") || strings.HasSuffix(f.Path, ".pth"):
			return "pytorch"
		}
	}
	return ""
}

// BuildModelCard writes README.md for the Hub from recorded facts only.
func BuildModelCard(c CardInfo) string {
	var b strings.Builder
	b.WriteString("---\n")
	if lib := libraryFor(c.Files); lib != "" {
		b.WriteString("library_name: " + lib + "\n")
	}
	b.WriteString("tags:\n- research-reproduction\n- research-lab\n")
	for _, p := range c.Papers {
		if p.ArxivID != "" {
			b.WriteString("- arxiv:" + strings.TrimPrefix(p.ArxivID, "arXiv:") + "\n")
		}
	}
	b.WriteString("---\n\n")

	name := c.RepoID
	if name == "" {
		name = c.Title
	}
	fmt.Fprintf(&b, "# %s\n\n", name)
	b.WriteString("Model files produced by an automated reproduction of the paper below in Research Lab. ")
	b.WriteString("The model was trained and evaluated by code that ran in an isolated sandbox; every number in this card was written by that code, not typed by a person or an AI.\n\n")

	b.WriteString("## Paper\n\n")
	if len(c.Papers) == 0 {
		b.WriteString("Not recorded.\n\n")
	}
	for _, p := range c.Papers {
		title := p.Title
		if title == "" {
			title = "Untitled paper"
		}
		if p.ArxivID != "" {
			id := strings.TrimPrefix(p.ArxivID, "arXiv:")
			fmt.Fprintf(&b, "- %s ([arXiv:%s](https://arxiv.org/abs/%s))\n", mdCell(title), id, id)
		} else {
			fmt.Fprintf(&b, "- %s\n", mdCell(title))
		}
	}
	if len(c.Papers) > 0 {
		b.WriteString("\n")
	}

	b.WriteString("## Provenance\n\n")
	fmt.Fprintf(&b, "- Run ID: %d\n", c.RunID)
	if c.ExecID > 0 {
		fmt.Fprintf(&b, "- Sandbox execution: %d\n", c.ExecID)
	}
	if c.CodeVersion != "" {
		fmt.Fprintf(&b, "- Code version: `%s`\n", c.CodeVersion)
	} else {
		b.WriteString("- Code version: Not recorded\n")
	}
	if c.FinishedAt != nil {
		fmt.Fprintf(&b, "- Finished: %s\n", c.FinishedAt.UTC().Format("2006-01-02 15:04 UTC"))
	}
	b.WriteString("\n")

	b.WriteString("## Evaluation results (measured)\n\n")
	if len(c.Metrics) == 0 {
		b.WriteString("Not recorded.\n\n")
	} else {
		claims := map[string]CardClaim{}
		for _, cl := range c.Claims {
			if cl.MetricName != "" {
				claims[cl.MetricName] = cl
			}
		}
		b.WriteString("Values measured by this run (`results/metrics.json`). The paper's value is shown separately where the paper reports the same metric.\n\n")
		b.WriteString("| Metric | Measured | Paper reports |\n|---|---|---|\n")
		for _, m := range c.Metrics {
			paper := "Not reported"
			if cl, ok := claims[m.Name]; ok {
				paper = num(cl.Value)
				if cl.Page != nil {
					paper += fmt.Sprintf(" (page %d)", *cl.Page)
				}
			}
			fmt.Fprintf(&b, "| %s | %s | %s |\n", mdCell(m.Name), num(m.Value), paper)
		}
		b.WriteString("\n")
	}

	b.WriteString("## Training configuration\n\n")
	if len(c.Settings) == 0 {
		b.WriteString("Not recorded.\n\n")
	} else {
		b.WriteString("| Setting | Value | Source |\n|---|---|---|\n")
		var changed []string
		for _, s := range c.Settings {
			src := sourceLabel[s.Source]
			if src == "" {
				src = s.Source
			}
			if s.SourceRef != "" {
				src += " (" + s.SourceRef + ")"
			}
			fmt.Fprintf(&b, "| %s | %s | %s |\n", mdCell(s.Name), mdCell(s.Value), mdCell(src))
			if s.Source == "compute_change" || s.Source == "assumption" {
				changed = append(changed, s.Name)
			}
		}
		b.WriteString("\n")
		if len(changed) > 0 {
			b.WriteString("## Limitations\n\n")
			b.WriteString("These settings differ from the paper or were not stated in it, so results may differ from the paper's: " +
				strings.Join(changed, ", ") + ".\n\n")
		}
	}

	b.WriteString("## Files\n\n| File | Size | SHA-256 |\n|---|---|---|\n")
	for _, f := range c.Files {
		fmt.Fprintf(&b, "| `%s` | %s | `%s` |\n", f.Path, humanSize(f.Size), f.SHA256[:min(12, len(f.SHA256))])
	}
	b.WriteString("\n")
	return b.String()
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}
