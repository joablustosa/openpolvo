-- Reverte schema Lovable SaaS (ordem inversa por dependências)

BEGIN;

DROP FUNCTION IF EXISTS rollback_project_to_version(UUID, UUID, UUID, TEXT);
DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON chat_conversations;
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON workspaces;
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
ALTER TABLE IF EXISTS projects DROP CONSTRAINT IF EXISTS fk_projects_current_version;
DROP TABLE IF EXISTS project_version_files CASCADE;
DROP TABLE IF EXISTS project_versions CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS workspace_members CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS users CASCADE;

COMMIT;
