-- Paper-to-Video Explainer: one row per generated video. The worker writes its files under
-- DATA_DIR/workspaces/{workspace_id}/explainer/{id}/ (script.json, public/ assets, video.mp4). Additive only.
CREATE TABLE IF NOT EXISTS explainer_videos (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id     BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    upload_id        BIGINT REFERENCES uploads(id) ON DELETE SET NULL,
    paper_title      TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'extracting', 'scripting', 'voicing', 'rendering', 'ready', 'failed')),
    progress         REAL NOT NULL DEFAULT 0,
    message          TEXT NOT NULL DEFAULT '',
    voice_id         TEXT NOT NULL DEFAULT '',
    fresh_script     BOOLEAN NOT NULL DEFAULT false,
    script           JSONB NOT NULL DEFAULT '{}',
    report           JSONB NOT NULL DEFAULT '{}',
    video_path       TEXT NOT NULL DEFAULT '',
    duration_seconds REAL NOT NULL DEFAULT 0,
    error            TEXT NOT NULL DEFAULT '',
    requested_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS explainer_videos_workspace_idx ON explainer_videos(workspace_id, id DESC);
