-- Hugging Face Hub publishing: one row per "Publish to Hugging Face". The file manifest (paths,
-- sizes, sha256) and the model card are fixed when the researcher confirms; the worker uploads
-- exactly those bytes and fails if a file changed since.

CREATE TABLE hf_publications (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source_exec_id  BIGINT REFERENCES sandbox_execs(id) ON DELETE SET NULL,
    repo_name       TEXT NOT NULL,              -- as entered: "name" or "owner/name"
    repo_id         TEXT NOT NULL DEFAULT '',   -- resolved "owner/name" (set by the worker)
    private         BOOLEAN NOT NULL DEFAULT true,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'uploading', 'succeeded', 'failed')),
    stage           TEXT NOT NULL DEFAULT 'queued',
    files           JSONB NOT NULL DEFAULT '[]',
    model_card      TEXT NOT NULL DEFAULT '',
    files_done      INT NOT NULL DEFAULT 0,
    files_total     INT NOT NULL DEFAULT 0,
    bytes_done      BIGINT NOT NULL DEFAULT 0,
    bytes_total     BIGINT NOT NULL DEFAULT 0,
    repo_url        TEXT NOT NULL DEFAULT '',
    commit_url      TEXT NOT NULL DEFAULT '',
    commit_sha      TEXT NOT NULL DEFAULT '',
    error           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX hf_publications_run_idx ON hf_publications(run_id, id);
CREATE UNIQUE INDEX hf_publications_active_idx ON hf_publications(run_id) WHERE status IN ('queued', 'uploading');
