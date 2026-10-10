package mcp

import (
	"encoding/json"
	"time"
)

// MCPTask represents a natural-language research task orchestrated with MCP tools.
type MCPTask struct {
	ID              int64           `json:"id"`
	WorkspaceID     int64           `json:"workspace_id"`
	RunID           *int64          `json:"run_id,omitempty"`
	UserID          int64           `json:"user_id"`
	Prompt          string          `json:"prompt"`
	Status          string          `json:"status"` // queued | running | waiting_approval | completed | failed | cancelled
	Model           string          `json:"model"`
	StepsCount      int             `json:"steps_count"`
	TokensUsed      int             `json:"tokens_used"`
	ApprovalPayload json.RawMessage `json:"approval_payload,omitempty"`
	Result          string          `json:"result"`
	Error           string          `json:"error,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	Steps           []MCPTaskStep   `json:"steps"`
}

// MCPTaskStep records a single tool invocation within an MCP task.
type MCPTaskStep struct {
	ID         int64           `json:"id"`
	TaskID     int64           `json:"task_id"`
	StepNumber int             `json:"step_number"`
	ToolName   string          `json:"tool_name"`
	ToolInput  json.RawMessage `json:"tool_input"`
	ToolOutput json.RawMessage `json:"tool_output"`
	Status     string          `json:"status"` // running | completed | error
	Error      string          `json:"error,omitempty"`
	DurationMS int64           `json:"duration_ms"`
	CreatedAt  time.Time       `json:"created_at"`
}

// ApprovalRequest represents an operation that requires explicit human confirmation.
type ApprovalRequest struct {
	ActionType  string         `json:"action_type"` // e.g. "publish_huggingface", "publish_github", "destructive_file_overwrite"
	Description string         `json:"description"`
	Payload     map[string]any `json:"payload"`
}

// Out wraps a standard tool execution result for the MCP server.
type Out struct {
	Result string `json:"result,omitempty"`
}


