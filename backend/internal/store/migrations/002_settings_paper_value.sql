-- The paper's own value for a setting (when we changed it to fit compute), used by the Gap Detective.
ALTER TABLE settings ADD COLUMN paper_value TEXT NOT NULL DEFAULT '';
-- Primary metric of a run (what what-if branches are ranked by).
ALTER TABLE runs ADD COLUMN primary_metric TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN primary_higher_is_better BOOLEAN NOT NULL DEFAULT false;
