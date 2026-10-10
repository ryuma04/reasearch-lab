package githubpush

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Finding struct {
	File        string `json:"file"`
	Line        int    `json:"line"`
	Rule        string `json:"rule"`
	Description string `json:"description"`
}

type ScanResult struct {
	Scanner  string    `json:"scanner"` // gitleaks | builtin
	Findings []Finding `json:"findings"`
	Clean    bool      `json:"clean"`
}

// Built-in rules, used when the gitleaks binary is not installed.
var builtinRules = []struct {
	name, desc string
	re         *regexp.Regexp
}{
	{"github-token", "GitHub token", regexp.MustCompile(`\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b`)},
	{"groq-api-key", "Groq API key", regexp.MustCompile(`\bgsk_[A-Za-z0-9]{40,}\b`)},
	{"google-api-key", "Google API key", regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{35}\b`)},
	{"openai-api-key", "OpenAI-style API key", regexp.MustCompile(`\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_\-]{32,}\b`)},
	{"aws-access-key", "AWS access key", regexp.MustCompile(`\b(AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{"hf-token", "Hugging Face token", regexp.MustCompile(`\bhf_[A-Za-z0-9]{30,}\b`)},
	{"telegram-bot-token", "Telegram bot token", regexp.MustCompile(`\b\d{8,10}:AA[A-Za-z0-9_\-]{33}\b`)},
	{"slack-token", "Slack token", regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{10,}\b`)},
	{"private-key", "Private key", regexp.MustCompile(`-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`)},
	{"generic-secret", "Hard-coded secret", regexp.MustCompile(`(?i)\b(api[_-]?key|secret|password|passwd|token|access[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{16,}["']`)},
}

// Scan writes the bundle to a temp dir and runs gitleaks; falls back to built-in rules.
func Scan(ctx context.Context, gitleaksBin string, files map[string][]byte) (*ScanResult, error) {
	if bin, err := exec.LookPath(gitleaksBin); err == nil {
		if res, err := scanGitleaks(ctx, bin, files); err == nil {
			return res, nil
		}
	}
	return scanBuiltin(files), nil
}

func scanGitleaks(ctx context.Context, bin string, files map[string][]byte) (*ScanResult, error) {
	dir, err := os.MkdirTemp("", "lab-scan-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	for p, data := range files {
		dst := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(dst, data, 0o600); err != nil {
			return nil, err
		}
	}
	report := filepath.Join(dir, ".gitleaks-report.json")
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "dir", dir, "--no-banner", "--report-format", "json",
		"--report-path", report, "--exit-code", "0", "--redact")
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, &scanErr{string(out)}
	}
	raw, err := os.ReadFile(report)
	if err != nil {
		return nil, err
	}
	var items []struct {
		File        string `json:"File"`
		StartLine   int    `json:"StartLine"`
		RuleID      string `json:"RuleID"`
		Description string `json:"Description"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	res := &ScanResult{Scanner: "gitleaks", Findings: []Finding{}}
	for _, it := range items {
		rel, _ := filepath.Rel(dir, it.File)
		res.Findings = append(res.Findings, Finding{File: filepath.ToSlash(rel), Line: it.StartLine, Rule: it.RuleID, Description: it.Description})
	}
	res.Clean = len(res.Findings) == 0
	return res, nil
}

type scanErr struct{ out string }

func (e *scanErr) Error() string { return "gitleaks failed: " + e.out }

func scanBuiltin(files map[string][]byte) *ScanResult {
	res := &ScanResult{Scanner: "builtin", Findings: []Finding{}}
	for p, data := range files {
		if bytes.IndexByte(data, 0) >= 0 { // binary
			continue
		}
		sc := bufio.NewScanner(bytes.NewReader(data))
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		n := 0
		for sc.Scan() {
			n++
			line := sc.Text()
			for _, r := range builtinRules {
				if r.re.MatchString(line) && !strings.Contains(line, "os.environ") && !strings.Contains(line, "getenv") {
					res.Findings = append(res.Findings, Finding{File: p, Line: n, Rule: r.name, Description: r.desc})
				}
			}
		}
	}
	res.Clean = len(res.Findings) == 0
	return res
}
