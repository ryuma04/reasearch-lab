package runs

import (
	"context"
	"testing"
)

func TestKnownAgent(t *testing.T) {
	for _, ok := range []string{"coding", "coding.writer", "research", "testing.runner", "gap_detective", "whatif"} {
		if !KnownAgent(ok) {
			t.Errorf("%s should be a known agent", ok)
		}
	}
	for _, bad := range []string{"manager", "coding.unknown", "", "../x"} {
		if KnownAgent(bad) {
			t.Errorf("%q must not be a known agent", bad)
		}
	}
}

func TestParseJUnit(t *testing.T) {
	xml := `<?xml version="1.0"?><testsuites><testsuite name="pytest">
<testcase classname="tests.test_correctness" name="test_softmax_sums_to_one" time="0.012"/>
<testcase classname="tests.test_claims" name="test_claim[student_distilled_test_errors]" time="0.001"><failure message="81 &gt; 81.4"/></testcase>
<testcase classname="tests.test_correctness" name="test_gpu" time="0"><skipped message="no gpu"/></testcase>
</testsuite></testsuites>`
	cases, err := ParseJUnit([]byte(xml))
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) != 3 {
		t.Fatalf("want 3 cases, got %d", len(cases))
	}
	if cases[0].Status != "passed" || cases[0].File != "tests/test_correctness.py" || cases[0].Kind != "correctness" || cases[0].Duration != 12 {
		t.Errorf("case 0: %+v", cases[0])
	}
	if cases[1].Status != "failed" || cases[1].Kind != "claim" || cases[1].Message == "" {
		t.Errorf("case 1: %+v", cases[1])
	}
	if cases[2].Status != "skipped" {
		t.Errorf("case 2: %+v", cases[2])
	}
}

func TestResolveRejectsBadEdits(t *testing.T) {
	s := &Service{}
	bad := []CheckpointResponse{
		{Action: "edit"}, // nothing to edit
		{Action: "edit", Changes: map[string]any{"a": []any{1}}}, // not a scalar
		{Action: "nope"},
	}
	for i, b := range bad {
		if _, err := s.Resolve(context.Background(), 1, "plan", b, 1, "web"); err == nil {
			t.Errorf("case %d: expected a validation error", i)
		}
	}
}

func TestValidateSettingChanges(t *testing.T) {
	if err := ValidateSettingChanges(map[string]any{"a": 1.0, "b": "x", "c": true}); err != nil {
		t.Fatalf("valid changes rejected: %v", err)
	}
	for name, bad := range map[string]map[string]any{
		"list":   {"a": []any{1}},
		"object": {"a": map[string]any{"x": 1}},
		"null":   {"a": nil},
		"long":   {"a": string(make([]byte, 201))},
	} {
		if ValidateSettingChanges(bad) == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
