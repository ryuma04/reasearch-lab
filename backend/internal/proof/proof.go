// Package proof enforces "no number without proof" on AI-written text (Hero 2, step 3).
// Any sentence containing a number that is not a recorded metric, a paper claim, a setting,
// a run/exec id, or a small counting number is removed and reported.
package proof

import (
	"context"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type Service struct{ store *store.Store }

func New(st *store.Store) *Service { return &Service{store: st} }

var (
	numberRe   = regexp.MustCompile(`[-+]?\d[\d,]*(?:\.\d+)?%?`)
	sentenceRe = regexp.MustCompile(`[^.!?\n]+(?:[.!?]+(?:\s|$)|\n|$)`)
)

type CheckRequest struct {
	RunID int64  `json:"run_id"` // the run and all its child runs are allowed sources
	Text  string `json:"text"`
}

type Flag struct {
	Sentence string   `json:"sentence"`
	Numbers  []string `json:"unproven_numbers"`
}

type CheckResult struct {
	CleanText string `json:"clean_text"`
	Flagged   []Flag `json:"flagged"`
	Allowed   int    `json:"allowed_values"`
}

// POST /internal/proof/check
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) error {
	var req CheckRequest
	if err := httpx.Decode(r, &req); err != nil {
		return err
	}
	res, err := s.Check(r.Context(), req.RunID, req.Text)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

func (s *Service) Check(ctx context.Context, runID int64, text string) (*CheckResult, error) {
	allowed, err := s.allowedValues(ctx, runID)
	if err != nil {
		return nil, err
	}
	res := &CheckResult{Flagged: []Flag{}, Allowed: len(allowed)}
	var kept []string
	for _, sent := range sentenceRe.FindAllString(text, -1) {
		var bad []string
		for _, tok := range numberRe.FindAllString(sent, -1) {
			if !isAllowed(tok, allowed) {
				bad = append(bad, tok)
			}
		}
		if len(bad) > 0 {
			res.Flagged = append(res.Flagged, Flag{Sentence: strings.TrimSpace(sent), Numbers: bad})
			continue
		}
		kept = append(kept, sent)
	}
	res.CleanText = strings.TrimSpace(strings.Join(kept, ""))
	return res, nil
}

func (s *Service) allowedValues(ctx context.Context, runID int64) ([]float64, error) {
	rows, err := s.store.Pool.Query(ctx, `
		WITH rs AS (SELECT id FROM runs WHERE id=$1 OR parent_run_id=$1)
		SELECT value FROM metrics WHERE run_id IN (SELECT id FROM rs)
		UNION ALL SELECT id::float8 FROM rs
		UNION ALL SELECT id::float8 FROM sandbox_execs WHERE run_id IN (SELECT id FROM rs)
		UNION ALL SELECT c.value FROM claims c JOIN papers p ON p.id=c.paper_id
			JOIN runs r ON r.workspace_id=p.workspace_id WHERE r.id=$1
		UNION ALL SELECT c.page::float8 FROM claims c JOIN papers p ON p.id=c.paper_id
			JOIN runs r ON r.workspace_id=p.workspace_id WHERE r.id=$1 AND c.page IS NOT NULL
		UNION ALL SELECT difference FROM scorecard_entries WHERE run_id=$1 AND difference IS NOT NULL
		UNION ALL SELECT relative_difference*100 FROM scorecard_entries WHERE run_id=$1 AND relative_difference IS NOT NULL`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []float64
	for rows.Next() {
		var v float64
		if err := rows.Scan(&v); err == nil {
			out = append(out, v)
		}
	}
	// Setting values (e.g. temperature 20, 5 epochs) are also facts we can cite.
	srows, err := s.store.Pool.Query(ctx, `SELECT value, paper_value FROM settings WHERE run_id IN
		(SELECT id FROM runs WHERE id=$1 OR parent_run_id=$1)`, runID)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var a, b string
		if err := srows.Scan(&a, &b); err == nil {
			for _, t := range numberRe.FindAllString(a+" "+b, -1) {
				if v, ok := parse(t); ok {
					out = append(out, v)
				}
			}
		}
	}
	return out, rows.Err()
}

func parse(tok string) (float64, bool) {
	t := strings.TrimSuffix(strings.ReplaceAll(tok, ",", ""), "%")
	v, err := strconv.ParseFloat(t, 64)
	return v, err == nil
}

func isAllowed(tok string, allowed []float64) bool {
	v, ok := parse(tok)
	if !ok {
		return true
	}
	// Small whole numbers are counting words ("3 runs", "2 differences").
	if v == math.Trunc(v) && math.Abs(v) <= 10 && !strings.HasSuffix(tok, "%") {
		return true
	}
	for _, a := range allowed {
		if close(v, a) || (strings.HasSuffix(tok, "%") && close(v/100, a)) {
			return true
		}
	}
	return false
}

// close accepts rounding to the precision the text used (e.g. 0.9812 written as 0.98 or 98.1%).
func close(written, actual float64) bool {
	if written == actual {
		return true
	}
	diff := math.Abs(written - actual)
	if diff <= 0.5 && math.Abs(actual) >= 10 && written == math.Round(written) {
		return true
	}
	scale := math.Max(math.Abs(actual), 1e-9)
	return diff/scale < 0.005
}
