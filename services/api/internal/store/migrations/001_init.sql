-- Full schema for the research environment (allaboutourproject.md, Section 22).
-- Owned by the Go API; the Python agent worker reads and writes the same tables.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    github_id       BIGINT UNIQUE,
    name            TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    github_username TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE github_connections (
    user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_token BYTEA,
    scopes          TEXT NOT NULL DEFAULT '',
    default_repo    TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
    connected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    compute_budget  TEXT NOT NULL DEFAULT 'quick' CHECK (compute_budget IN ('quick', 'standard', 'deep')),
    mode            TEXT NOT NULL DEFAULT 'reproduce' CHECK (mode IN ('reproduce', 'compare')),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
    workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE uploads (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('paper', 'dataset', 'repo_link', 'note')),
    path_or_url     TEXT NOT NULL,
    original_name   TEXT NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE papers (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id         BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    upload_id            BIGINT REFERENCES uploads(id) ON DELETE SET NULL,
    title                TEXT NOT NULL DEFAULT '',
    arxiv_id             TEXT NOT NULL DEFAULT '',
    pdf_path             TEXT NOT NULL DEFAULT '',
    parsed_markdown_path TEXT NOT NULL DEFAULT '',
    summary              TEXT NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claims (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    paper_id         BIGINT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    metric_name      TEXT NOT NULL DEFAULT '',          -- key expected in metrics.json, e.g. student_distilled_test_errors
    description      TEXT NOT NULL,
    value            DOUBLE PRECISION NOT NULL,
    unit             TEXT NOT NULL DEFAULT '',
    higher_is_better BOOLEAN NOT NULL DEFAULT false,
    tolerance        DOUBLE PRECISION NOT NULL DEFAULT 0.10, -- relative tolerance for "match"
    page             INT,
    table_ref        TEXT NOT NULL DEFAULT '',
    position_on_page JSONB,                             -- {"x0":..,"y0":..,"x1":..,"y1":..,"page_width":..,"page_height":..}
    condition        TEXT NOT NULL DEFAULT '',
    quote            TEXT NOT NULL DEFAULT ''           -- exact source text from the paper
);

CREATE TABLE runs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id    BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_run_id   BIGINT REFERENCES runs(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'whatif', 'gap_test')),
    branch_name     TEXT NOT NULL DEFAULT 'main',
    compute_budget  TEXT NOT NULL DEFAULT 'quick',
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'waiting_approval', 'paused', 'stopped', 'rejected', 'completed', 'failed')),
    stage           TEXT NOT NULL DEFAULT 'queued',    -- research | plan_approval | coding | testing | gap | whatif | push | done
    settings_override JSONB NOT NULL DEFAULT '{}',
    error           TEXT NOT NULL DEFAULT '',
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    git_commit      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_workspace_idx ON runs(workspace_id);
CREATE INDEX runs_parent_idx ON runs(parent_run_id);

CREATE TABLE settings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    value       TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('paper', 'official_code', 'assumption', 'compute_change', 'researcher')),
    source_ref  TEXT NOT NULL DEFAULT '',
    reason      TEXT NOT NULL DEFAULT '',
    UNIQUE (run_id, name)
);

CREATE TABLE run_events (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id  BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    time    TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent   TEXT NOT NULL,
    type    TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    why     TEXT NOT NULL DEFAULT '',
    links   JSONB NOT NULL DEFAULT '{}',
    cost    JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX run_events_run_idx ON run_events(run_id, id);

-- One row per sandbox execution (the proof trail for every metric).
CREATE TABLE sandbox_execs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    phase           TEXT NOT NULL CHECK (phase IN ('install', 'execute', 'test')),
    command         TEXT NOT NULL,
    image           TEXT NOT NULL DEFAULT '',
    exit_code       INT,
    timed_out       BOOLEAN NOT NULL DEFAULT false,
    duration_ms     BIGINT NOT NULL DEFAULT 0,
    log_path        TEXT NOT NULL DEFAULT '',
    log_hash        TEXT NOT NULL DEFAULT '',
    code_version    TEXT NOT NULL DEFAULT '',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);

CREATE TABLE metrics (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    exec_id         BIGINT REFERENCES sandbox_execs(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    code_version    TEXT NOT NULL DEFAULT '',
    log_file        TEXT NOT NULL DEFAULT '',
    log_file_hash   TEXT NOT NULL DEFAULT '',
    log_line        INT,
    log_line_text   TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX metrics_run_idx ON metrics(run_id, name);

CREATE TABLE scorecard_entries (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    claim_id    BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    metric_id   BIGINT REFERENCES metrics(id) ON DELETE SET NULL,
    difference  DOUBLE PRECISION,
    relative_difference DOUBLE PRECISION,
    status      TEXT NOT NULL CHECK (status IN ('match', 'close', 'different', 'missing')),
    explanation TEXT NOT NULL DEFAULT '',
    UNIQUE (run_id, claim_id)
);

CREATE TABLE whatif_branches (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id           BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,  -- the main run being extended
    child_run_id     BIGINT REFERENCES runs(id) ON DELETE SET NULL,          -- the run that executes this branch
    question_id      TEXT NOT NULL DEFAULT '',                               -- groups branches created from one question
    question         TEXT NOT NULL,
    label            TEXT NOT NULL DEFAULT '',
    settings_change  JSONB NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'stopped_early', 'done', 'failed')),
    round            INT NOT NULL DEFAULT 0,
    result_metric_id BIGINT REFERENCES metrics(id) ON DELETE SET NULL,
    reason           TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gap_analyses (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    claim_id     BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    differences  JSONB NOT NULL DEFAULT '[]',   -- ranked list of setup differences
    experiments  JSONB NOT NULL DEFAULT '[]',   -- [{difference, child_run_id, metric_id}]
    explanation  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,         -- e.g. coding.debugger, specialist.environment_fixer.v2
    name               TEXT NOT NULL,
    kind               TEXT NOT NULL CHECK (kind IN ('manager', 'core', 'observer', 'specialist')),
    parent_slug        TEXT NOT NULL DEFAULT '',     -- core agent that owns a sub-agent
    template           TEXT NOT NULL DEFAULT '',     -- specialist template it was created from
    stage              TEXT NOT NULL DEFAULT 'trial'
                       CHECK (stage IN ('trial', 'active', 'refined', 'merged', 'replaced', 'retired')),
    current_version_id BIGINT,
    avg_score          DOUBLE PRECISION NOT NULL DEFAULT 0,
    tasks_count        INT NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_versions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id       BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version        INT NOT NULL DEFAULT 1,
    instructions   TEXT NOT NULL,
    tools          JSONB NOT NULL DEFAULT '[]',
    model          TEXT NOT NULL DEFAULT '',
    skill_tags     TEXT[] NOT NULL DEFAULT '{}',
    created_reason TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agents ADD CONSTRAINT agents_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES agent_versions(id) ON DELETE SET NULL;

CREATE TABLE agent_tasks (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    agent_id        BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill           TEXT NOT NULL DEFAULT '',
    outcome         DOUBLE PRECISION,              -- 0..1
    feedback        DOUBLE PRECISION,              -- -1, 0 (neutral), +1
    tokens          INT NOT NULL DEFAULT 0,
    sandbox_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    wasted_tries    INT NOT NULL DEFAULT 0,
    score           DOUBLE PRECISION,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_tasks_agent_idx ON agent_tasks(agent_id, created_at);

CREATE TABLE team_decisions (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      BIGINT REFERENCES runs(id) ON DELETE CASCADE,
    decision    TEXT NOT NULL CHECK (decision IN ('create', 'refine', 'merge', 'replace', 'retire', 'assign', 'promote')),
    agent_ids   BIGINT[] NOT NULL DEFAULT '{}',
    skill       TEXT NOT NULL DEFAULT '',
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('proposed', 'applied', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memory_items (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('error_fix', 'setting', 'experiment', 'agent_skill', 'paper_recipe')),
    text         TEXT NOT NULL,
    details      JSONB NOT NULL DEFAULT '{}',
    embedding    vector(384),
    source_run_id BIGINT REFERENCES runs(id) ON DELETE SET NULL,
    times_used   INT NOT NULL DEFAULT 0,
    times_succeeded INT NOT NULL DEFAULT 0,
    success_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX memory_items_kind_idx ON memory_items(kind);

CREATE TABLE notes (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id       BIGINT REFERENCES runs(id) ON DELETE SET NULL,
    author_type  TEXT NOT NULL CHECK (author_type IN ('user', 'agent')),
    author       TEXT NOT NULL,                  -- user id or agent slug
    title        TEXT NOT NULL DEFAULT '',
    markdown     TEXT NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notes_workspace_idx ON notes(workspace_id);

CREATE TABLE comments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_type  TEXT NOT NULL,
    target_id    TEXT NOT NULL,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pushes (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id             BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
    repo_url           TEXT NOT NULL DEFAULT '',
    commit_urls        JSONB NOT NULL DEFAULT '[]',
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'blocked', 'pushing', 'done', 'failed')),
    method             TEXT NOT NULL DEFAULT '',     -- n8n | direct
    secret_scan_result JSONB NOT NULL DEFAULT '{}',
    error              TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ
);

CREATE TABLE share_links (
    token        TEXT PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval checkpoints (plan, long_run, help, push).
CREATE TABLE checkpoints (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'edited', 'rejected')),
    payload     JSONB NOT NULL DEFAULT '{}',    -- what the researcher is asked to review
    response    JSONB NOT NULL DEFAULT '{}',    -- {action, instruction, option}
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX checkpoints_pending_idx ON checkpoints(run_id, name) WHERE status = 'pending';

-- Observer Agent's live map (nodes/edges, converted to Excalidraw elements in the browser).
CREATE TABLE research_maps (
    run_id     BIGINT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    graph      JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    version    INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telegram bot: linking a chat to a user, and pending one-tap confirmations.
CREATE TABLE telegram_links (
    user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id    BIGINT UNIQUE,
    link_code  TEXT UNIQUE,
    linked_at  TIMESTAMPTZ
);

CREATE TABLE telegram_pending (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id    BIGINT NOT NULL,
    action     JSONB NOT NULL,                  -- {type: checkpoint|whatif|agent_action|push, ...}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
