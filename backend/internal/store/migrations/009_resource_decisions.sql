-- The researcher's decision on each recommended resource (accept / reject / keep original / supplement).
-- Additive and backward compatible: no existing table is changed.
CREATE TABLE IF NOT EXISTS resource_decisions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id     BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    rec_id     TEXT NOT NULL,
    decision   TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'keep_original', 'supplement')),
    note       TEXT NOT NULL DEFAULT '',
    user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, rec_id)
);
