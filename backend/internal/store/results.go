package store

import (
	"context"
	"encoding/json"
	"time"
)

// QueryJSON runs a SELECT and returns all rows as a JSON array (built by Postgres).
func (s *Store) QueryJSON(ctx context.Context, sql string, args ...any) (json.RawMessage, error) {
	var out json.RawMessage
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(json_agg(t), '[]'::json) FROM (`+sql+`) t`, args...).Scan(&out)
	return out, err
}

// QueryJSONOne returns the first row as a JSON object, or ErrNotFound.
func (s *Store) QueryJSONOne(ctx context.Context, sql string, args ...any) (json.RawMessage, error) {
	var out json.RawMessage
	err := s.Pool.QueryRow(ctx, `SELECT row_to_json(t) FROM (`+sql+`) t LIMIT 1`, args...).Scan(&out)
	return out, notFound(err)
}

// Proof card fields for a metric: run, code version, log file, log line, time.
const metricProofCols = `m.id, m.run_id, m.name, m.value, m.code_version, m.log_file, m.log_file_hash,
	m.log_line, m.log_line_text, m.created_at, m.exec_id`

func (s *Store) Scorecard(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT se.id, se.status, se.difference, se.relative_difference, se.explanation,
			json_build_object('id', c.id, 'description', c.description, 'metric_name', c.metric_name,
				'value', c.value, 'unit', c.unit, 'higher_is_better', c.higher_is_better, 'tolerance', c.tolerance,
				'page', c.page, 'table_ref', c.table_ref, 'position_on_page', c.position_on_page,
				'condition', c.condition, 'quote', c.quote, 'paper_id', c.paper_id,
				'paper_upload_id', p.upload_id, 'paper_title', p.title) AS claim,
			CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object(
				'id', m.id, 'run_id', m.run_id, 'name', m.name, 'value', m.value,
				'code_version', m.code_version, 'log_file', m.log_file, 'log_file_hash', m.log_file_hash,
				'log_line', m.log_line, 'log_line_text', m.log_line_text, 'created_at', m.created_at) END AS ours
		FROM scorecard_entries se
		JOIN claims c ON c.id = se.claim_id
		JOIN papers p ON p.id = c.paper_id
		LEFT JOIN metrics m ON m.id = se.metric_id
		WHERE se.run_id = $1 ORDER BY c.id`, runID)
}

func (s *Store) Settings(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `SELECT id, name, value, source, source_ref, reason, paper_value
		FROM settings WHERE run_id=$1 ORDER BY name`, runID)
}

func (s *Store) Metrics(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `SELECT `+metricProofCols+` FROM metrics m WHERE m.run_id=$1 ORDER BY m.id`, runID)
}

func (s *Store) MetricByID(ctx context.Context, id int64) (json.RawMessage, error) {
	return s.QueryJSONOne(ctx, `SELECT `+metricProofCols+` FROM metrics m WHERE m.id=$1`, id)
}

func (s *Store) Papers(ctx context.Context, wsID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT p.id, p.upload_id, p.title, p.arxiv_id, p.summary, p.created_at,
			(SELECT COALESCE(json_agg(c ORDER BY c.id), '[]'::json) FROM (
				SELECT id, metric_name, description, value, unit, higher_is_better, tolerance, page,
					table_ref, position_on_page, condition, quote FROM claims WHERE paper_id = p.id) c) AS claims
		FROM papers p WHERE p.workspace_id=$1 ORDER BY p.id`, wsID)
}

func (s *Store) ResearchMap(ctx context.Context, runID int64) (json.RawMessage, error) {
	out, err := s.QueryJSONOne(ctx, `SELECT run_id, graph, version, updated_at FROM research_maps WHERE run_id=$1`, runID)
	if err == ErrNotFound {
		return json.RawMessage(`{"run_id":` + itoa(runID) + `,"graph":{"nodes":[],"edges":[]},"version":0}`), nil
	}
	return out, err
}

func (s *Store) GapAnalyses(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT g.id, g.claim_id, c.description AS claim, g.differences, g.experiments, g.explanation, g.created_at
		FROM gap_analyses g JOIN claims c ON c.id = g.claim_id WHERE g.run_id=$1 ORDER BY g.id`, runID)
}

func (s *Store) WhatIfBranches(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT b.id, b.question_id, b.question, b.label, b.settings_change, b.status, b.round, b.reason,
			b.child_run_id, b.created_at, cr.branch_name, cr.status AS child_status,
			CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object('id', m.id, 'name', m.name, 'value', m.value,
				'run_id', m.run_id, 'log_line', m.log_line, 'code_version', m.code_version) END AS result
		FROM whatif_branches b
		LEFT JOIN runs cr ON cr.id = b.child_run_id
		LEFT JOIN metrics m ON m.id = b.result_metric_id
		WHERE b.run_id=$1 ORDER BY b.id`, runID)
}

func (s *Store) AgentTasksForRun(ctx context.Context, runID int64) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT t.id, t.agent_id, a.slug, a.name, t.skill, t.outcome, t.feedback, t.tokens,
			t.sandbox_seconds, t.wasted_tries, t.score, t.notes, t.created_at
		FROM agent_tasks t JOIN agents a ON a.id = t.agent_id
		WHERE t.run_id=$1 ORDER BY t.id`, runID)
}

func (s *Store) TeamDecisions(ctx context.Context, runID *int64, limit int) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT d.id, d.run_id, d.decision, d.agent_ids, d.skill, d.reason, d.status, d.created_at,
			(SELECT COALESCE(json_agg(a.slug), '[]'::json) FROM agents a WHERE a.id = ANY(d.agent_ids)) AS agents
		FROM team_decisions d WHERE ($1::bigint IS NULL OR d.run_id = $1)
		ORDER BY d.id DESC LIMIT $2`, runID, limit)
}

func (s *Store) Agents(ctx context.Context) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT a.id, a.slug, a.name, a.kind, a.parent_slug, a.template, a.stage, a.avg_score, a.tasks_count,
			a.created_at, v.version, v.model, v.skill_tags, v.tools,
			(SELECT COALESCE(json_object_agg(skill, avg), '{}'::json) FROM (
				SELECT skill, round(avg(score)::numeric, 3) AS avg FROM agent_tasks
				WHERE agent_id = a.id AND score IS NOT NULL GROUP BY skill) ss) AS skill_scores
		FROM agents a LEFT JOIN agent_versions v ON v.id = a.current_version_id
		ORDER BY (a.stage = 'retired'), a.kind, a.slug`)
}

func (s *Store) AgentHistory(ctx context.Context, agentID int64) (json.RawMessage, error) {
	return s.QueryJSONOne(ctx, `
		SELECT a.id, a.slug, a.name, a.kind, a.stage, a.avg_score, a.tasks_count,
			(SELECT COALESCE(json_agg(v ORDER BY v.version), '[]'::json) FROM (
				SELECT id, version, instructions, tools, model, skill_tags, created_reason, created_at
				FROM agent_versions WHERE agent_id = a.id) v) AS versions,
			(SELECT COALESCE(json_agg(t ORDER BY t.id DESC), '[]'::json) FROM (
				SELECT id, run_id, skill, outcome, feedback, tokens, sandbox_seconds, wasted_tries, score, notes, created_at
				FROM agent_tasks WHERE agent_id = a.id ORDER BY id DESC LIMIT 100) t) AS tasks,
			(SELECT COALESCE(json_agg(d ORDER BY d.id DESC), '[]'::json) FROM (
				SELECT id, run_id, decision, skill, reason, status, created_at
				FROM team_decisions WHERE a.id = ANY(agent_ids)) d) AS decisions
		FROM agents a WHERE a.id=$1`, agentID)
}

func (s *Store) MemoryTextSearch(ctx context.Context, q, kind string, limit int) (json.RawMessage, error) {
	return s.QueryJSON(ctx, `
		SELECT id, kind, text, details, times_used, success_rate, source_run_id, created_at
		FROM memory_items
		WHERE ($2 = '' OR kind = $2) AND ($1 = '' OR text ILIKE '%' || $1 || '%')
		ORDER BY times_used DESC, id DESC LIMIT $3`, q, kind, limit)
}

// SetTaskFeedback records researcher thumbs up/down on the latest task of an agent in a run.
func (s *Store) SetTaskFeedback(ctx context.Context, runID int64, agentSlug string, feedback float64) (int64, error) {
	var id int64
	err := s.Pool.QueryRow(ctx, `
		UPDATE agent_tasks SET feedback=$3 WHERE id = (
			SELECT t.id FROM agent_tasks t JOIN agents a ON a.id = t.agent_id
			WHERE t.run_id=$1 AND a.slug=$2 ORDER BY t.id DESC LIMIT 1)
		RETURNING id`, runID, agentSlug, feedback).Scan(&id)
	return id, notFound(err)
}

func (s *Store) AgentExists(ctx context.Context, slug string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agents WHERE slug=$1)`, slug).Scan(&ok)
	return ok, err
}

// ---------- what-if ----------

func (s *Store) CreateWhatIfQuestion(ctx context.Context, runID int64, questionID, question string) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO whatif_branches (run_id, question_id, question, label, status, reason)
		VALUES ($1, $2, $3, 'planning', 'pending', 'Team Manager is turning the question into branches')`,
		runID, questionID, question)
	return err
}

// ---------- share links ----------

func (s *Store) CreateShareLink(ctx context.Context, token string, wsID int64, expires time.Time) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO share_links (token, workspace_id, expires_at) VALUES ($1, $2, $3)`, token, wsID, expires)
	return err
}

func (s *Store) ShareLinkWorkspace(ctx context.Context, token string) (int64, error) {
	var ws int64
	err := s.Pool.QueryRow(ctx, `SELECT workspace_id FROM share_links WHERE token=$1 AND expires_at > now()`, token).Scan(&ws)
	return ws, notFound(err)
}
