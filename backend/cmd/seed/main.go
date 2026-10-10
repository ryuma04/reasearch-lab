// Command seed creates an email + password account and two SAMPLE workspaces with illustrative
// data, for walking a mentor through the screens before real runs exist.
//
//	go run ./cmd/seed -email you@example.com -password '...' [-name "Your Name"]
//
// Every sample workspace is titled "Sample — …" and carries a note saying its numbers are
// illustrative and were not produced by a sandbox run (the product's rule is "no number
// without proof", so sample data must never look like a real result). Re-running replaces
// only the sample workspaces of that account; it never touches other data.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

const sampleNote = "SAMPLE DATA for a walkthrough. The numbers below are illustrative and were NOT produced by a sandbox run. Start a real run to get proof-linked results."

func main() {
	email := flag.String("email", "", "account email (required)")
	password := flag.String("password", "", "account password (required, at least 6 characters)")
	name := flag.String("name", "", "display name (optional)")
	flag.Parse()
	if *email == "" || len(*password) < 6 {
		log.Fatal("usage: seed -email you@example.com -password '<at least 6 chars>' [-name Name]")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		log.Fatal(err)
	}

	addr := strings.ToLower(strings.TrimSpace(*email))
	if *name == "" {
		*name, _, _ = strings.Cut(addr, "@")
	}
	uid := upsertUser(ctx, st, addr, *name, *password)

	// Replace earlier sample workspaces of this account (cascades to runs, events, files rows).
	if _, err := st.Pool.Exec(ctx, `DELETE FROM workspaces WHERE owner_id=$1 AND title LIKE 'Sample — %'`, uid); err != nil {
		log.Fatal(err)
	}
	s := &seeder{st: st, cfg: cfg, ctx: ctx, uid: uid}
	s.distillation()
	s.pinn()
	s.endToEnd()
	fmt.Printf("seeded user %s (id %d) with 3 sample workspaces\n", addr, uid)
}

func upsertUser(ctx context.Context, st *store.Store, email, name, password string) int64 {
	hash, err := auth.HashPassword(password)
	if err != nil {
		log.Fatal(err)
	}
	var id int64
	err = st.Pool.QueryRow(ctx, `UPDATE users SET name=$2, password_hash=$3
		WHERE github_id IS NULL AND password_hash <> '' AND lower(email)=lower($1) RETURNING id`, email, name, hash).Scan(&id)
	if err == pgx.ErrNoRows {
		err = st.Pool.QueryRow(ctx, `INSERT INTO users (name, email, github_username, password_hash)
			VALUES ($1, $2, '', $3) RETURNING id`, name, email, hash).Scan(&id)
	}
	if err != nil {
		log.Fatal(err)
	}
	return id
}

type seeder struct {
	st  *store.Store
	cfg *config.Config
	ctx context.Context
	uid int64
}

func (s *seeder) one(sql string, args ...any) int64 {
	var id int64
	if err := s.st.Pool.QueryRow(s.ctx, sql+" RETURNING id", args...).Scan(&id); err != nil {
		log.Fatalf("%v\n%s", err, sql)
	}
	return id
}

func (s *seeder) exec(sql string, args ...any) {
	if _, err := s.st.Pool.Exec(s.ctx, sql, args...); err != nil {
		log.Fatalf("%v\n%s", err, sql)
	}
}

func j(v any) []byte { b, _ := json.Marshal(v); return b }

type claim struct {
	metric, desc, table, quote string
	paper, ours                float64
	page                       int
	status, expl               string
}

type event struct {
	agent, typ, msg, why string
	links                map[string]any
	tokens               int
	sandbox              float64
}

type sample struct {
	title, arxiv, paperTitle, summary, budget string
	claims                                    []claim
	settings                                  [][5]string // name, value, source, reason, paper value
	events                                    []event
	brief, train                              string
	gap                                       map[string]any
	gapClaim                                  int // index into claims
	whatifQ                                   string
	branches                                  [][3]any // label, value, status
	branchMetric                              string
	memory                                    [][2]string // kind, text
	recipeDir                                 string      // real project files to copy (relative to the repo root)
	extraFiles                                map[string]string
}

func (s *seeder) workspace(x sample) {
	ws := s.one(`INSERT INTO workspaces (owner_id, title, compute_budget, note) VALUES ($1,$2,$3,$4)`,
		s.uid, x.title, x.budget, sampleNote)
	s.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, ws, s.uid)
	up := s.one(`INSERT INTO uploads (workspace_id, kind, path_or_url) VALUES ($1,'paper',$2)`, ws, "https://arxiv.org/abs/"+x.arxiv)
	paper := s.one(`INSERT INTO papers (workspace_id, upload_id, title, arxiv_id, summary) VALUES ($1,$2,$3,$4,$5)`,
		ws, up, x.paperTitle, x.arxiv, x.summary)

	start := time.Now().Add(-26 * time.Hour)
	run := s.one(`INSERT INTO runs (workspace_id, compute_budget, status, stage, started_at, finished_at, git_commit, primary_metric)
		VALUES ($1,$2,'completed','done',$3,$4,'5a3c9e1f20b7',$5)`, ws, x.budget, start, start.Add(11*time.Minute), x.claims[len(x.claims)-1].metric)

	// Project files so the Coding / Research tabs have something to open.
	dir := filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(ws, run)))
	logText := "[SAMPLE DATA — not a real sandbox log]\n"
	for _, c := range x.claims {
		logText += fmt.Sprintf("%s: %g\n", c.metric, c.ours)
	}
	files := map[string]string{
		"research/brief.md":    x.brief,
		"src/train.py":         x.train,
		"logs/execute-1.log":   logText,
		"results/metrics.json": string(j(metricsMap(x.claims))),
		"README.md":            "# " + x.paperTitle + "\n\n> " + sampleNote + "\n",
	}
	for p, body := range x.extraFiles {
		files[p] = body
	}
	if x.recipeDir != "" {
		root := filepath.Join(repoRoot(), filepath.FromSlash(x.recipeDir))
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || strings.Contains(p, "__pycache__") {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			if b, err := os.ReadFile(p); err == nil {
				files[filepath.ToSlash(rel)] = string(b)
			}
			return nil
		})
	}
	for p, body := range files {
		full := filepath.Join(dir, filepath.FromSlash(p))
		_ = os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			log.Fatal(err)
		}
	}
	sum := sha256.Sum256([]byte(logText))
	logHash := "sha256:" + hex.EncodeToString(sum[:])
	exec := s.one(`INSERT INTO sandbox_execs (run_id, phase, command, image, exit_code, duration_ms, log_path, log_hash, code_version, started_at, finished_at)
		VALUES ($1,'execute','python src/train.py','tapu-sena/sandbox-python:latest',0,412000,'logs/execute-1.log',$2,'5a3c9e1f20b7',$3,$4)`,
		run, logHash, start.Add(3*time.Minute), start.Add(10*time.Minute))

	for i, c := range x.claims {
		cid := s.one(`INSERT INTO claims (paper_id, metric_name, description, value, unit, tolerance, page, table_ref, condition, quote)
			VALUES ($1,$2,$3,$4,'',0.10,$5,$6,'',$7)`, paper, c.metric, c.desc, c.paper, c.page, c.table, c.quote)
		mid := s.one(`INSERT INTO metrics (run_id, exec_id, name, value, code_version, log_file, log_file_hash, log_line, log_line_text)
			VALUES ($1,$2,$3,$4,'5a3c9e1f20b7','logs/execute-1.log',$5,$6,$7)`,
			run, exec, c.metric, c.ours, logHash, i+2, fmt.Sprintf("%s: %g", c.metric, c.ours))
		diff := c.ours - c.paper
		s.exec(`INSERT INTO scorecard_entries (run_id, claim_id, metric_id, difference, relative_difference, status, explanation)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`, run, cid, mid, diff, abs(diff)/c.paper, c.status, c.expl)
		if i == x.gapClaim && x.gap != nil {
			s.exec(`INSERT INTO gap_analyses (run_id, claim_id, differences, experiments, explanation) VALUES ($1,$2,$3,$4,$5)`,
				run, cid, j(x.gap["differences"]), j(x.gap["experiments"]), x.gap["explanation"])
		}
	}
	for _, st := range x.settings {
		s.exec(`INSERT INTO settings (run_id, name, value, source, reason, paper_value) VALUES ($1,$2,$3,$4,$5,$6)`,
			run, st[0], st[1], st[2], st[3], st[4])
	}
	s.exec(`INSERT INTO checkpoints (run_id, name, status, payload, response, created_at, resolved_at)
		VALUES ($1,'plan','approved','{}',$2,$3,$4)`, run, j(map[string]any{"action": "approve", "via": "web"}),
		start.Add(2*time.Minute), start.Add(3*time.Minute))

	t := start
	for _, e := range x.events {
		t = t.Add(17 * time.Second)
		links := e.links
		if links == nil {
			links = map[string]any{}
		}
		s.exec(`INSERT INTO run_events (run_id, time, agent, type, message, why, links, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			run, t, e.agent, e.typ, e.msg, e.why, j(links), j(map[string]any{"tokens": e.tokens, "sandbox_seconds": e.sandbox}))
	}

	// Research map (Observer output).
	nodes := []map[string]any{{"id": "paper", "kind": "paper", "label": x.paperTitle, "status": "done"}}
	edges := []map[string]any{}
	for i, c := range x.claims {
		st := map[string]string{"match": "done", "close": "done", "different": "problem"}[c.status]
		id := fmt.Sprintf("claim:%d", i)
		nodes = append(nodes, map[string]any{"id": id, "kind": "claim", "label": c.desc, "status": st})
		edges = append(edges, map[string]any{"from": "paper", "to": id, "label": "claims"}, map[string]any{"from": "code:train", "to": id, "label": "measures"})
	}
	nodes = append(nodes, map[string]any{"id": "code:train", "kind": "code", "label": "src/train.py", "status": "done"},
		map[string]any{"id": "test:claims", "kind": "test", "label": "tests/test_claims.py", "status": "done"})
	edges = append(edges, map[string]any{"from": "test:claims", "to": "code:train", "label": "tests"})
	s.exec(`INSERT INTO research_maps (run_id, graph, version) VALUES ($1,$2,1)`, run, j(map[string]any{"nodes": nodes, "edges": edges}))

	// What-if branches as child runs with their own (sample) metric.
	for i, b := range x.branches {
		child := s.one(`INSERT INTO runs (workspace_id, parent_run_id, kind, branch_name, compute_budget, status, stage, started_at, finished_at)
			VALUES ($1,$2,'whatif',$3,$4,$5,'done',$6,$7)`, ws, run, fmt.Sprintf("whatif/%s", slug(b[0].(string))), x.budget,
			map[string]string{"done": "completed", "stopped_early": "stopped"}[b[2].(string)], start.Add(time.Duration(14+i)*time.Minute), start.Add(time.Duration(18+i)*time.Minute))
		mid := s.one(`INSERT INTO metrics (run_id, name, value, code_version, log_file, log_file_hash, log_line, log_line_text)
			VALUES ($1,$2,$3,'5a3c9e1f20b7','logs/execute-1.log',$4,2,$5)`, child, x.branchMetric, b[1], logHash, fmt.Sprintf("%s: %v", x.branchMetric, b[1]))
		reason := "best branch"
		if b[2] == "stopped_early" {
			reason = "stopped early: clearly worse after the first short round"
		} else if i > 0 {
			reason = "finished both rounds"
		}
		s.exec(`INSERT INTO whatif_branches (run_id, child_run_id, question_id, question, label, settings_change, status, round, result_metric_id, reason)
			VALUES ($1,$2,'q_sample',$3,$4,'{}',$5,$6,$7,$8)`, run, child, x.whatifQ, b[0], b[2], map[bool]int{true: 1, false: 2}[b[2] == "stopped_early"], mid, reason)
	}

	for _, m := range x.memory {
		s.exec(`INSERT INTO memory_items (kind, text, details, source_run_id, times_used, times_succeeded, success_rate)
			VALUES ($1,$2,$3,$4,2,2,1)`, m[0], "[sample] "+m[1], j(map[string]any{"sample": true}), run)
	}
	s.exec(`INSERT INTO notes (workspace_id, run_id, author_type, author, title, markdown) VALUES ($1,$2,'agent','research.paper_reader','Research Brief',$3)`,
		ws, run, x.brief)
	s.exec(`INSERT INTO notes (workspace_id, author_type, author, title, markdown) VALUES ($1,'user',$2,'Research notes',$3)`,
		ws, fmt.Sprint(s.uid), "## Notes for the mentor review\n\n- "+sampleNote+"\n- Ask: which what-if would be most convincing for the judges?\n")
}

// repoRoot finds the repository root (the folder containing agents/ and backend/).
func repoRoot() string {
	dir, _ := os.Getwd()
	for i := 0; i < 4; i++ {
		if _, err := os.Stat(filepath.Join(dir, "agents", "lab")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return "."
}

func metricsMap(cs []claim) map[string]float64 {
	m := map[string]float64{}
	for _, c := range cs {
		m[c.metric] = c.ours
	}
	return m
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func slug(s string) string {
	s = strings.ToLower(s)
	out := []rune{}
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out = append(out, r)
		} else if len(out) > 0 && out[len(out)-1] != '-' {
			out = append(out, '-')
		}
	}
	return strings.Trim(string(out), "-")
}
