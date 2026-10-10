-- MCP tasks and tool call history for persistent AI orchestration.
-- Survives browser refreshes and provides a full audit trail.

CREATE TABLE mcp_tasks (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id      BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id            BIGINT REFERENCES runs(id) ON DELETE CASCADE,
    user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt            TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
    model             TEXT NOT NULL DEFAULT 'claude-3-7-sonnet-20250219',
    steps_count       INT NOT NULL DEFAULT 0,
    tokens_used       INT NOT NULL DEFAULT 0,
    approval_payload  JSONB,
    result            TEXT NOT NULL DEFAULT '',
    error             TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mcp_task_steps (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id      BIGINT NOT NULL REFERENCES mcp_tasks(id) ON DELETE CASCADE,
    step_number  INT NOT NULL,
    tool_name    TEXT NOT NULL,
    tool_input   JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_output  JSONB NOT NULL DEFAULT '{}'::jsonb,
    status       TEXT NOT NULL DEFAULT 'completed'
                 CHECK (status IN ('running', 'completed', 'error')),
    error        TEXT NOT NULL DEFAULT '',
    duration_ms  BIGINT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mcp_tasks_run_idx ON mcp_tasks(run_id, id DESC);
CREATE INDEX mcp_tasks_workspace_idx ON mcp_tasks(workspace_id, id DESC);
CREATE INDEX mcp_task_steps_task_idx ON mcp_task_steps(task_id, step_number);
