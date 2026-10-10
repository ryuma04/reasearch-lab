-- Research Gap Explorer: one analysis per run, plus researcher feedback. Isolated from the research workflow tables.
CREATE TABLE IF NOT EXISTS explorer_analyses (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    stage        TEXT NOT NULL DEFAULT '',             -- discovering | enriching | extracting | comparing | gaps | recommendations
    data         JSONB NOT NULL DEFAULT '{}',          -- timeline, comparison, gaps, recommendations, warnings
    error        TEXT NOT NULL DEFAULT '',
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS explorer_analyses_run_idx ON explorer_analyses(run_id);

CREATE TABLE IF NOT EXISTS explorer_feedback (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    analysis_id BIGINT NOT NULL REFERENCES explorer_analyses(id) ON DELETE CASCADE,
    item_type   TEXT NOT NULL CHECK (item_type IN ('recommendation', 'gap', 'idea')),
    item_id     TEXT NOT NULL,
    decision    TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected', 'edited', 'investigate', 'added')),
    reason      TEXT NOT NULL DEFAULT '',
    edited      JSONB NOT NULL DEFAULT '{}',           -- researcher's refined text, or a custom idea {title, text}
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS explorer_feedback_item_idx ON explorer_feedback(analysis_id, item_type, item_id, COALESCE(user_id, 0));
