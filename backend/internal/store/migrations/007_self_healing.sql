-- Self-Healing Debugger: one session per "Fix with AI" (or agent repair loop), one row per attempt.
-- Every attempt keeps the original error, the explanation, the exact diff applied and the real
-- result of re-running the patched code (and its tests) in a fresh sandbox container.

CREATE TABLE heal_sessions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id         BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source_exec_id BIGINT REFERENCES sandbox_execs(id) ON DELETE SET NULL,
    entrypoint     TEXT NOT NULL DEFAULT 'src/train.py',
    status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'fixed', 'failed', 'error')),
    max_attempts   INT NOT NULL DEFAULT 3,
    message        TEXT NOT NULL DEFAULT '',
    tokens         INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ
);
CREATE INDEX heal_sessions_run_idx ON heal_sessions(run_id, id);
CREATE UNIQUE INDEX heal_sessions_active_idx ON heal_sessions(run_id) WHERE status IN ('queued', 'running');

CREATE TABLE repair_attempts (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id    BIGINT NOT NULL REFERENCES heal_sessions(id) ON DELETE CASCADE,
    run_id        BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    attempt       INT NOT NULL,
    error_kind    TEXT NOT NULL DEFAULT '',
    error_summary TEXT NOT NULL DEFAULT '',
    error_text    TEXT NOT NULL DEFAULT '',
    fix_source    TEXT NOT NULL DEFAULT '' CHECK (fix_source IN ('', 'memory', 'pattern', 'cache', 'arina', 'fallback_ai')),
    explanation   TEXT NOT NULL DEFAULT '',
    diff          TEXT NOT NULL DEFAULT '',
    files         JSONB NOT NULL DEFAULT '[]',
    exec_id       BIGINT REFERENCES sandbox_execs(id) ON DELETE SET NULL,
    test_exec_id  BIGINT REFERENCES sandbox_execs(id) ON DELETE SET NULL,
    tests         JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'fixed', 'still_failing', 'tests_failed', 'no_fix', 'sandbox_error')),
    tokens        INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX repair_attempts_session_idx ON repair_attempts(session_id, attempt);
