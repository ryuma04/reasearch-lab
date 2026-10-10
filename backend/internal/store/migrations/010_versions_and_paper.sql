-- Natural-language change requests (each creates a new version = a new run linked to its source) and the
-- research-paper materials generated for a run. Additive: no existing table is changed.
CREATE TABLE IF NOT EXISTS change_requests (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_run_id BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    new_run_id    BIGINT REFERENCES runs(id) ON DELETE SET NULL,
    request_text  TEXT NOT NULL,
    request_hash  TEXT NOT NULL,                       -- makes a repeated submit (double click, retry) return the same version
    status        TEXT NOT NULL DEFAULT 'analyzing' CHECK (status IN ('analyzing', 'analyzed', 'failed')),
    analysis      JSONB NOT NULL DEFAULT '{}',
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_run_id, request_hash)
);
CREATE INDEX IF NOT EXISTS change_requests_new_run_idx ON change_requests(new_run_id);

CREATE TABLE IF NOT EXISTS paper_materials (
    run_id       BIGINT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'partial', 'failed')),
    manifest     JSONB NOT NULL DEFAULT '{}',
    error        TEXT NOT NULL DEFAULT '',
    requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
