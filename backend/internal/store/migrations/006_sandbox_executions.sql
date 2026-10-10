-- Sandbox executions become first-class: status, who started them (agent or researcher), the
-- repair attempt number, separate stderr, validated metrics/artifacts and the limits applied.
-- 'verify' is the offline step that checks saved model artifacts can be loaded.

ALTER TABLE sandbox_execs DROP CONSTRAINT IF EXISTS sandbox_execs_phase_check;
ALTER TABLE sandbox_execs ADD CONSTRAINT sandbox_execs_phase_check
    CHECK (phase IN ('install', 'execute', 'test', 'verify'));

ALTER TABLE sandbox_execs
    ADD COLUMN status         TEXT NOT NULL DEFAULT 'queued',
    ADD COLUMN source         TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'user')),
    ADD COLUMN agent          TEXT NOT NULL DEFAULT '',
    ADD COLUMN user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN attempt        INT NOT NULL DEFAULT 1,
    ADD COLUMN entrypoint     TEXT NOT NULL DEFAULT '',
    ADD COLUMN stderr_path    TEXT NOT NULL DEFAULT '',
    ADD COLUMN error          TEXT NOT NULL DEFAULT '',
    ADD COLUMN cancelled      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN metrics_status TEXT NOT NULL DEFAULT 'not_collected',
    ADD COLUMN metrics_error  TEXT NOT NULL DEFAULT '',
    ADD COLUMN artifacts      JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN limits         JSONB NOT NULL DEFAULT '{}';

-- Executions recorded before this migration.
UPDATE sandbox_execs SET status = CASE
    WHEN finished_at IS NULL THEN 'error'
    WHEN timed_out THEN 'timed_out'
    WHEN exit_code = 0 THEN 'succeeded'
    ELSE 'failed' END;

ALTER TABLE sandbox_execs ADD CONSTRAINT sandbox_execs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'error'));
ALTER TABLE sandbox_execs ADD CONSTRAINT sandbox_execs_metrics_status_check
    CHECK (metrics_status IN ('not_collected', 'valid', 'invalid', 'missing'));

CREATE INDEX IF NOT EXISTS sandbox_execs_run_idx ON sandbox_execs(run_id, id);
