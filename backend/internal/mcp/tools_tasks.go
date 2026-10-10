package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type TaskGetStatusIn struct {
	TaskID int64 `json:"task_id"`
}

type TaskTrackProgressIn struct {
	TaskID int64 `json:"task_id"`
}

type TaskCancelIn struct {
	TaskID int64 `json:"task_id"`
}

type TaskResumeIn struct {
	TaskID int64 `json:"task_id"`
}

type TaskRequestApprovalIn struct {
	TaskID      int64          `json:"task_id"`
	ActionType  string         `json:"action_type"`
	Description string         `json:"description"`
	Payload     map[string]any `json:"payload,omitempty"`
}

func (s *Server) handleTaskGetStatus(ctx context.Context, in TaskGetStatusIn) (any, error) {
	task, err := s.loadTask(ctx, in.TaskID)
	if err != nil {
		return nil, fmt.Errorf("task %d not found: %w", in.TaskID, err)
	}

	return map[string]any{
		"task": task,
	}, nil
}

func (s *Server) handleTaskTrackProgress(ctx context.Context, in TaskTrackProgressIn) (any, error) {
	task, err := s.loadTask(ctx, in.TaskID)
	if err != nil {
		return nil, fmt.Errorf("task %d not found: %w", in.TaskID, err)
	}

	return map[string]any{
		"task_id":          task.ID,
		"status":           task.Status,
		"steps_count":      task.StepsCount,
		"tokens_used":      task.TokensUsed,
		"waiting_approval": task.Status == "waiting_approval",
		"approval_payload": task.ApprovalPayload,
		"created_at":       task.CreatedAt,
		"updated_at":       task.UpdatedAt,
	}, nil
}

func (s *Server) handleTaskCancel(ctx context.Context, in TaskCancelIn) (any, error) {
	tag, err := s.store.Pool.Exec(ctx, `
		UPDATE mcp_tasks
		SET status = 'cancelled', updated_at = now()
		WHERE id = $1 AND status IN ('running', 'queued', 'waiting_approval')`, in.TaskID)
	if err != nil {
		return nil, fmt.Errorf("cancelling task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return map[string]any{"task_id": in.TaskID, "cancelled": false, "message": "Task already terminated or not found"}, nil
	}

	var runID *int64
	_ = s.store.Pool.QueryRow(ctx, `SELECT run_id FROM mcp_tasks WHERE id=$1`, in.TaskID).Scan(&runID)
	if runID != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   *runID,
			Agent:   "assistant",
			Type:    "mcp_task_cancelled",
			Message: fmt.Sprintf("MCP Task #%d cancelled by researcher", in.TaskID),
			Why:     "Task cancelled control",
			Links:   mustJSON(map[string]any{"task_id": in.TaskID}),
		})
	}

	return map[string]any{
		"task_id":   in.TaskID,
		"cancelled": true,
		"status":    "cancelled",
		"message":   fmt.Sprintf("Task %d cancelled successfully", in.TaskID),
	}, nil
}

func (s *Server) handleTaskResume(ctx context.Context, in TaskResumeIn) (any, error) {
	tag, err := s.store.Pool.Exec(ctx, `
		UPDATE mcp_tasks
		SET status = 'running', updated_at = now()
		WHERE id = $1 AND status IN ('waiting_approval', 'queued')`, in.TaskID)
	if err != nil {
		return nil, fmt.Errorf("resuming task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return map[string]any{"task_id": in.TaskID, "resumed": false, "message": "Task cannot be resumed from current status"}, nil
	}

	return map[string]any{
		"task_id": in.TaskID,
		"resumed": true,
		"status":  "running",
		"message": fmt.Sprintf("Task %d resumed successfully", in.TaskID),
	}, nil
}

func (s *Server) handleTaskRequestApproval(ctx context.Context, in TaskRequestApprovalIn) (any, error) {
	payloadBytes, _ := json.Marshal(in.Payload)
	_, err := s.store.Pool.Exec(ctx, `
		UPDATE mcp_tasks
		SET status = 'waiting_approval', approval_payload = $1, updated_at = now()
		WHERE id = $2`, payloadBytes, in.TaskID)
	if err != nil {
		return nil, fmt.Errorf("updating task approval state: %w", err)
	}

	var runID *int64
	_ = s.store.Pool.QueryRow(ctx, `SELECT run_id FROM mcp_tasks WHERE id=$1`, in.TaskID).Scan(&runID)
	if runID != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   *runID,
			Agent:   "assistant",
			Type:    "mcp_approval_needed",
			Message: fmt.Sprintf("Approval required: %s (%s)", in.ActionType, in.Description),
			Why:     "Sensitive operation gating",
			Links:   mustJSON(map[string]any{"task_id": in.TaskID, "action_type": in.ActionType, "payload": in.Payload}),
		})
	}

	return map[string]any{
		"task_id":          in.TaskID,
		"status":           "waiting_approval",
		"action_type":      in.ActionType,
		"description":      in.Description,
		"waiting_approval": true,
	}, nil
}

func (s *Server) loadTask(ctx context.Context, taskID int64) (*MCPTask, error) {
	row := s.store.Pool.QueryRow(ctx, `
		SELECT id, workspace_id, run_id, user_id, prompt, status, model, steps_count, tokens_used,
		       coalesce(approval_payload, '{}'::jsonb), result, error, created_at, updated_at
		FROM mcp_tasks WHERE id = $1`, taskID)

	var t MCPTask
	err := row.Scan(&t.ID, &t.WorkspaceID, &t.RunID, &t.UserID, &t.Prompt, &t.Status, &t.Model, &t.StepsCount,
		&t.TokensUsed, &t.ApprovalPayload, &t.Result, &t.Error, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Load steps
	sRows, err := s.store.Pool.Query(ctx, `
		SELECT id, task_id, step_number, tool_name, tool_input, tool_output, status, error, duration_ms, created_at
		FROM mcp_task_steps
		WHERE task_id = $1
		ORDER BY step_number ASC`, taskID)
	if err == nil {
		defer sRows.Close()
		t.Steps, _ = pgx.CollectRows(sRows, func(row pgx.CollectableRow) (MCPTaskStep, error) {
			var step MCPTaskStep
			err := row.Scan(&step.ID, &step.TaskID, &step.StepNumber, &step.ToolName, &step.ToolInput,
				&step.ToolOutput, &step.Status, &step.Error, &step.DurationMS, &step.CreatedAt)
			return step, err
		})
	}
	if t.Steps == nil {
		t.Steps = []MCPTaskStep{}
	}

	return &t, nil
}
