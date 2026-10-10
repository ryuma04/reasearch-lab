package runs

import (
	"encoding/xml"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
)

type testCase struct {
	Name     string `json:"name"`
	File     string `json:"file"`
	Kind     string `json:"kind"` // correctness | claim
	Status   string `json:"status"`
	Duration int64  `json:"duration_ms"`
	Message  string `json:"message,omitempty"`
}

type junitCase struct {
	Name      string  `xml:"name,attr"`
	Classname string  `xml:"classname,attr"`
	Time      float64 `xml:"time,attr"`
	Failure   *struct {
		Message string `xml:"message,attr"`
	} `xml:"failure"`
	Error *struct {
		Message string `xml:"message,attr"`
	} `xml:"error"`
	Skipped *struct {
		Message string `xml:"message,attr"`
	} `xml:"skipped"`
}

// ParseJUnit turns the pytest JUnit report written in the sandbox into test cases.
func ParseJUnit(data []byte) ([]testCase, error) {
	var doc struct {
		Cases  []junitCase `xml:"testcase"`
		Suites []struct {
			Cases []junitCase `xml:"testcase"`
		} `xml:"testsuite"`
	}
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	all := doc.Cases
	for _, s := range doc.Suites {
		all = append(all, s.Cases...)
	}
	out := make([]testCase, 0, len(all))
	for _, c := range all {
		tc := testCase{Name: c.Name, Status: "passed", Duration: int64(c.Time * 1000), Kind: "correctness"}
		if c.Classname != "" {
			tc.File = strings.ReplaceAll(c.Classname, ".", "/") + ".py"
		}
		if strings.Contains(tc.File, "claim") || strings.HasPrefix(c.Name, "test_claim") {
			tc.Kind = "claim"
		}
		switch {
		case c.Failure != nil:
			tc.Status, tc.Message = "failed", c.Failure.Message
		case c.Error != nil:
			tc.Status, tc.Message = "error", c.Error.Message
		case c.Skipped != nil:
			tc.Status, tc.Message = "skipped", c.Skipped.Message
		}
		out = append(out, tc)
	}
	return out, nil
}

// GET /runs/{id}/tests — the test report the Test Runner produced in the sandbox
// (results/junit.xml). An empty list means the tests have not run yet.
func (s *Service) Tests(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(s.projectDir(run), "results", "junit.xml"))
	tests := []testCase{}
	if err == nil {
		if parsed, perr := ParseJUnit(data); perr == nil {
			tests = parsed
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"run_id": run.ID, "ran": err == nil, "tests": tests})
	return nil
}

// GET /runs/{id}/memory — what this run (and its child runs) taught the Lab Memory, and which
// memory items it reused (fix_applied events with links.from_memory).
func (s *Service) RunMemory(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	ctx := r.Context()
	learned, err := s.store.QueryJSON(ctx, `
		SELECT id, kind, text, details, times_used, success_rate, source_run_id, created_at FROM memory_items
		WHERE source_run_id IN (SELECT id FROM runs WHERE id=$1 OR parent_run_id=$1) ORDER BY id`, run.ID)
	if err != nil {
		return err
	}
	reused, err := s.store.QueryJSON(ctx, `
		SELECT json_build_object('id', m.id, 'kind', m.kind, 'text', m.text, 'details', m.details,
				'times_used', m.times_used, 'success_rate', m.success_rate, 'source_run_id', m.source_run_id) AS item,
			e.time AS used_at, e.id AS event_id, e.agent
		FROM run_events e JOIN memory_items m ON m.id = (e.links->>'memory_item')::bigint
		WHERE (e.run_id=$1 OR e.run_id IN (SELECT id FROM runs WHERE parent_run_id=$1))
			AND e.type='fix_applied' AND (e.links->>'from_memory')::boolean IS TRUE
		ORDER BY e.id`, run.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"learned": learned, "reused": reused})
	return nil
}
