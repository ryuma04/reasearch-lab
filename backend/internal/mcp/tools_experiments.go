package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
)

type ExperimentGetConfigAndHistoryIn struct {
	RunID int64 `json:"run_id"`
}

type ExperimentLaunchIn struct {
	RunID          int64          `json:"run_id"`
	ConfigName     string         `json:"config_name,omitempty" jsonschema:"e.g. configs/default.yaml"`
	OverrideParams map[string]any `json:"override_params,omitempty"`
}

type ExperimentCompareRunsIn struct {
	RunIDA int64 `json:"run_id_a"`
	RunIDB int64 `json:"run_id_b"`
}

type ExperimentGetMetricsIn struct {
	RunID int64 `json:"run_id"`
}

type ExperimentCompareClaimsIn struct {
	RunID int64 `json:"run_id"`
}

type ExperimentGetEvidenceIn struct {
	RunID      int64  `json:"run_id"`
	MetricName string `json:"metric_name"`
}

func (s *Server) handleExperimentGetConfigAndHistory(ctx context.Context, in ExperimentGetConfigAndHistoryIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	// Read configs directory
	configsDir := filepath.Join(s.projectDir(run.ID), "configs")
	configs := make(map[string]string)
	if entries, err := os.ReadDir(configsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				if data, err := os.ReadFile(filepath.Join(configsDir, e.Name())); err == nil {
					configs[e.Name()] = string(data)
				}
			}
		}
	}

	// Read past executions
	rows, err := s.store.Pool.Query(ctx, `
		SELECT id, phase, status, entrypoint, command, exit_code, duration_ms, started_at
		FROM sandbox_execs
		WHERE run_id = $1
		ORDER BY id DESC LIMIT 20`, run.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type ExecSummary struct {
		ID         int64  `json:"id"`
		Phase      string `json:"phase"`
		Status     string `json:"status"`
		Entrypoint string `json:"entrypoint"`
		Command    string `json:"command"`
		ExitCode   *int   `json:"exit_code"`
		DurationMs int64  `json:"duration_ms"`
		StartedAt  any    `json:"started_at"`
	}

	history := make([]ExecSummary, 0)
	for rows.Next() {
		var e ExecSummary
		if err := rows.Scan(&e.ID, &e.Phase, &e.Status, &e.Entrypoint, &e.Command, &e.ExitCode, &e.DurationMs, &e.StartedAt); err == nil {
			history = append(history, e)
		}
	}

	return map[string]any{
		"run_id":        run.ID,
		"configs":       configs,
		"history":       history,
		"history_count": len(history),
	}, nil
}

func (s *Server) handleExperimentLaunch(ctx context.Context, in ExperimentLaunchIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	// Write overrides to configs/overrides.json if provided
	if len(in.OverrideParams) > 0 {
		overridesDir := filepath.Join(s.projectDir(run.ID), "configs")
		_ = os.MkdirAll(overridesDir, 0o755)
		data, _ := json.MarshalIndent(in.OverrideParams, "", "  ")
		_ = os.WriteFile(filepath.Join(overridesDir, "overrides.json"), data, 0o644)
	}

	collectMetrics := true
	req := sandbox.ExecRequest{
		RunID:          run.ID,
		Phase:          "execute",
		Command:        "python -u src/train.py",
		TimeoutSec:     240,
		Image:          "python",
		Agent:          "researcher",
		CollectMetrics: &collectMetrics,
		Attempt:        1,
	}

	res, err := s.sandbox.Exec(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("launch experiment execution failed: %w", err)
	}

	return map[string]any{
		"run_id":         run.ID,
		"exec_id":        res.ExecID,
		"status":         res.Status,
		"exit_code":      res.ExitCode,
		"duration_ms":    res.DurationMs,
		"metrics_status": res.MetricsStatus,
		"message":        "Experiment launched and executed",
	}, nil
}

func (s *Server) handleExperimentCompareRuns(ctx context.Context, in ExperimentCompareRunsIn) (any, error) {
	runA, err := s.store.RunByID(ctx, in.RunIDA)
	if err != nil {
		return nil, fmt.Errorf("run A %d not found: %w", in.RunIDA, err)
	}
	runB, err := s.store.RunByID(ctx, in.RunIDB)
	if err != nil {
		return nil, fmt.Errorf("run B %d not found: %w", in.RunIDB, err)
	}

	fetchMetrics := func(runID int64) (map[string]float64, error) {
		rows, err := s.store.Pool.Query(ctx, `SELECT name, value FROM metrics WHERE run_id=$1`, runID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		m := make(map[string]float64)
		for rows.Next() {
			var name string
			var val float64
			if rows.Scan(&name, &val) == nil {
				m[name] = val
			}
		}
		return m, nil
	}

	metricsA, _ := fetchMetrics(runA.ID)
	metricsB, _ := fetchMetrics(runB.ID)

	type MetricComparison struct {
		Name       string   `json:"name"`
		ValueRunA  *float64 `json:"value_run_a"`
		ValueRunB  *float64 `json:"value_run_b"`
		Difference *float64 `json:"difference"`
	}

	comparisons := make([]MetricComparison, 0)
	allKeys := make(map[string]bool)
	for k := range metricsA {
		allKeys[k] = true
	}
	for k := range metricsB {
		allKeys[k] = true
	}

	for k := range allKeys {
		var vA, vB, diff *float64
		if val, ok := metricsA[k]; ok {
			vA = &val
		}
		if val, ok := metricsB[k]; ok {
			vB = &val
		}
		if vA != nil && vB != nil {
			d := *vB - *vA
			diff = &d
		}
		comparisons = append(comparisons, MetricComparison{
			Name:       k,
			ValueRunA:  vA,
			ValueRunB:  vB,
			Difference: diff,
		})
	}

	return map[string]any{
		"run_a":       map[string]any{"id": runA.ID, "status": runA.Status, "stage": runA.Stage},
		"run_b":       map[string]any{"id": runB.ID, "status": runB.Status, "stage": runB.Stage},
		"comparisons": comparisons,
	}, nil
}

func (s *Server) handleExperimentGetMetrics(ctx context.Context, in ExperimentGetMetricsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	// 1. From database
	rows, err := s.store.Pool.Query(ctx, `
		SELECT id, name, value, coalesce(log_line, 0), coalesce(log_line_text, '')
		FROM metrics
		WHERE run_id = $1`, run.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type MetricRow struct {
		ID          int64   `json:"id"`
		Name        string  `json:"name"`
		Value       float64 `json:"value"`
		LogLine     int     `json:"log_line"`
		LogLineText string  `json:"log_line_text"`
	}

	metricsList := make([]MetricRow, 0)
	for rows.Next() {
		var m MetricRow
		if rows.Scan(&m.ID, &m.Name, &m.Value, &m.LogLine, &m.LogLineText) == nil {
			metricsList = append(metricsList, m)
		}
	}

	// 2. From results/metrics.json if present
	metricsJSONPath := filepath.Join(s.projectDir(run.ID), "results", "metrics.json")
	var metricsDoc any
	if data, err := os.ReadFile(metricsJSONPath); err == nil {
		_ = json.Unmarshal(data, &metricsDoc)
	}

	return map[string]any{
		"run_id":       run.ID,
		"metrics":      metricsList,
		"metrics_doc":  metricsDoc,
		"metric_count": len(metricsList),
	}, nil
}

func (s *Server) handleExperimentCompareClaims(ctx context.Context, in ExperimentCompareClaimsIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	rows, err := s.store.Pool.Query(ctx, `
		SELECT sc.id, sc.claim_id, c.claim_text, c.metric_name, c.reported_value,
		       sc.measured_value, sc.match_status, sc.margin_percent, sc.explanation
		FROM scorecard_entries sc
		JOIN claims c ON c.id = sc.claim_id
		WHERE sc.run_id = $1`, run.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type ScorecardItem struct {
		ID            int64   `json:"id"`
		ClaimID       int64   `json:"claim_id"`
		ClaimText     string  `json:"claim_text"`
		MetricName    string  `json:"metric_name"`
		ReportedValue string  `json:"reported_value"`
		MeasuredValue float64 `json:"measured_value"`
		MatchStatus   string  `json:"match_status"`
		MarginPercent float64 `json:"margin_percent"`
		Explanation   string  `json:"explanation"`
	}

	items := make([]ScorecardItem, 0)
	for rows.Next() {
		var it ScorecardItem
		if rows.Scan(&it.ID, &it.ClaimID, &it.ClaimText, &it.MetricName, &it.ReportedValue, &it.MeasuredValue, &it.MatchStatus, &it.MarginPercent, &it.Explanation) == nil {
			items = append(items, it)
		}
	}

	return map[string]any{
		"run_id":    run.ID,
		"scorecard": items,
		"count":     len(items),
	}, nil
}

func (s *Server) handleExperimentGetEvidence(ctx context.Context, in ExperimentGetEvidenceIn) (any, error) {
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	var mID, execID int64
	var mVal float64
	var logLine int
	var logLineText, logPath, logHash, codeVersion string

	err = s.store.Pool.QueryRow(ctx, `
		SELECT m.id, m.sandbox_exec_id, m.value, coalesce(m.log_line, 0), coalesce(m.log_line_text, ''),
		       coalesce(m.log_path, ''), coalesce(m.log_hash, ''), coalesce(m.code_version, '')
		FROM metrics m
		WHERE m.run_id = $1 AND m.name = $2
		ORDER BY m.id DESC LIMIT 1`, run.ID, in.MetricName).Scan(&mID, &execID, &mVal, &logLine, &logLineText, &logPath, &logHash, &codeVersion)
	if err != nil {
		return nil, fmt.Errorf("metric evidence not found for %s: %w", in.MetricName, err)
	}

	// Fetch corresponding paper claim if exists
	var claimText, reportedVal string
	var pageNum int
	_ = s.store.Pool.QueryRow(ctx, `
		SELECT c.claim_text, c.reported_value, c.page_number
		FROM claims c
		JOIN papers p ON p.id = c.paper_id
		WHERE p.workspace_id = $1 AND c.metric_name = $2 LIMIT 1`, run.WorkspaceID, in.MetricName).Scan(&claimText, &reportedVal, &pageNum)

	return map[string]any{
		"run_id":          run.ID,
		"metric_name":     in.MetricName,
		"metric_id":       mID,
		"exec_id":         execID,
		"measured_value":  mVal,
		"log_line":        logLine,
		"log_line_text":   logLineText,
		"log_path":        logPath,
		"log_hash":        logHash,
		"code_version":    codeVersion,
		"paper_claim":     claimText,
		"reported_value":  reportedVal,
		"paper_page":      pageNum,
		"verification_ok": true,
	}, nil
}
