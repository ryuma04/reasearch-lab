-- The Team Manager, agent scoring and team evolution were removed: the run is a fixed pipeline of agents.
DROP TABLE IF EXISTS team_decisions;
DROP TABLE IF EXISTS agent_tasks;
ALTER TABLE IF EXISTS agents DROP CONSTRAINT IF EXISTS agents_current_version_fk;
DROP TABLE IF EXISTS agent_versions;
DROP TABLE IF EXISTS agents;
DELETE FROM memory_items WHERE kind = 'agent_skill';
