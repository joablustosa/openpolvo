-- Open Polvo — schema PostgreSQL para SaaS estilo Lovable (BR)
-- Workspaces → Projects → Project_Versions (Git-like) + Chat_Messages com snapshot
--
-- Supabase: substituir `users` por perfil ligado a auth.users (ver comentário abaixo).
-- Aplicar: psql $DATABASE_URL -f 001_lovable_saas.up.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
-- Em Supabase, preferir:
--   CREATE TABLE users (
--     id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
--     ...
--   );
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    display_name    TEXT,
    password_hash   TEXT,                          -- NULL se OAuth-only
    avatar_url      TEXT,
    locale          TEXT NOT NULL DEFAULT 'pt-BR',
    timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    plan_tier       TEXT NOT NULL DEFAULT 'free',  -- free | pro | team | enterprise
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_plan_tier CHECK (plan_tier IN ('free', 'pro', 'team', 'enterprise'))
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_plan_tier ON users (plan_tier) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- Workspaces (conta / equipa — um utilizador pode ter vários)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,                 -- único globalmente (URL amigável)
    description     TEXT,
    settings        JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_personal     BOOLEAN NOT NULL DEFAULT FALSE, -- workspace pessoal auto-criado
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ,
    CONSTRAINT uq_workspaces_slug UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces (updated_at DESC) WHERE archived_at IS NULL;

-- Membros (multi-utilizador por workspace)
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'editor', -- owner | admin | editor | viewer
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at       TIMESTAMPTZ,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT ck_workspace_members_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id, workspace_id);

-- ---------------------------------------------------------------------------
-- Projects (dezenas por workspace; cada um com histórico de versões)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_by_user_id  UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL,              -- único dentro do workspace
    description         TEXT,
    stack_hint          TEXT,                       -- vite-react | next-react | go-api …
    status              TEXT NOT NULL DEFAULT 'active', -- active | archived | deleted
    -- Ponteiro para versão actual (HEAD) — rollback = actualizar este FK
    current_version_id  UUID,                         -- FK adicionada após project_versions
    preview_url         TEXT,
    settings            JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at         TIMESTAMPTZ,
    CONSTRAINT uq_projects_workspace_slug UNIQUE (workspace_id, slug),
    CONSTRAINT ck_projects_status CHECK (status IN ('active', 'archived', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_updated
    ON projects (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_status
    ON projects (workspace_id, status, updated_at DESC)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_projects_created_by
    ON projects (created_by_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Project_Versions — controlo de versão estilo Git (snapshots imutáveis)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,           -- 1, 2, 3… sequencial por projecto
    parent_version_id   UUID REFERENCES project_versions (id) ON DELETE SET NULL,
    created_by_user_id  UUID REFERENCES users (id) ON DELETE SET NULL,
  -- Mensagem estilo commit (ex.: "Adiciona landing de cafeteria")
    summary             TEXT NOT NULL DEFAULT '',
    source              TEXT NOT NULL DEFAULT 'codegen', -- codegen | self_heal | manual | rollback | import
    snapshot_hash       CHAR(64) NOT NULL,          -- SHA-256 do manifesto (dedup)
    file_manifest       JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{path, sha256, size, lang}]
    metadata            JSONB NOT NULL DEFAULT '{}'::JSONB, -- tokens, route, compile_ok …
    is_head             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_versions_project_number UNIQUE (project_id, version_number),
    CONSTRAINT ck_project_versions_source CHECK (
        source IN ('codegen', 'self_heal', 'manual', 'rollback', 'import', 'initial')
    ),
    CONSTRAINT ck_project_versions_number_positive CHECK (version_number > 0)
);

-- Conteúdo dos ficheiros por versão (normalizado — permite diff parcial)
CREATE TABLE IF NOT EXISTS project_version_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES project_versions (id) ON DELETE CASCADE,
    path            TEXT NOT NULL,                  -- relativo, ex.: src/App.tsx
    content         TEXT NOT NULL,
    content_hash    CHAR(64) NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    lang            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_version_files_version_path UNIQUE (version_id, path),
    CONSTRAINT ck_project_version_files_path CHECK (path NOT LIKE '/%' AND path NOT LIKE '%..%')
);

CREATE INDEX IF NOT EXISTS idx_project_versions_project_created
    ON project_versions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_versions_project_number
    ON project_versions (project_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_project_versions_head
    ON project_versions (project_id)
    WHERE is_head = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_versions_parent
    ON project_versions (parent_version_id)
    WHERE parent_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_version_files_version
    ON project_version_files (version_id);
CREATE INDEX IF NOT EXISTS idx_project_version_files_path
    ON project_version_files (path);

-- FK circular: projects.current_version_id → project_versions
ALTER TABLE projects
    ADD CONSTRAINT fk_projects_current_version
    FOREIGN KEY (current_version_id) REFERENCES project_versions (id) ON DELETE SET NULL;

-- Apenas uma HEAD por projecto
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_versions_one_head
    ON project_versions (project_id)
    WHERE is_head = TRUE;

-- ---------------------------------------------------------------------------
-- Chat — conversa por projecto (thread Lovable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    workspace_id        UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    started_by_user_id  UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title               TEXT,
    default_model       TEXT NOT NULL DEFAULT 'openai',
    langgraph_thread_id TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chat_conversations_project UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace_updated
    ON chat_conversations (workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Chat_Messages — cada mensagem pode referenciar o snapshot de código daquele momento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id         UUID NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    workspace_id            UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    author_user_id          UUID REFERENCES users (id) ON DELETE SET NULL, -- NULL = assistant/system
    role                    TEXT NOT NULL,              -- user | assistant | system | tool
    content                 TEXT NOT NULL,
    metadata                JSONB NOT NULL DEFAULT '{}'::JSONB,
    -- Snapshot de código produzido/consumido neste turno
    project_version_id      UUID REFERENCES project_versions (id) ON DELETE SET NULL,
    base_version_id         UUID REFERENCES project_versions (id) ON DELETE SET NULL, -- estado antes do turno
    prompt_tokens           INTEGER,
    completion_tokens       INTEGER,
    model_provider          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_chat_messages_role CHECK (role IN ('user', 'assistant', 'system', 'tool'))
);

-- Histórico de prompts por projecto (consulta principal Lovable)
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created
    ON chat_messages (project_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project_role_created
    ON chat_messages (project_id, role, created_at DESC)
    WHERE role = 'user';

-- Histórico por conversa (replay do chat)
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
    ON chat_messages (conversation_id, created_at ASC);

-- Histórico cross-project por utilizador (dashboard / auditoria)
CREATE INDEX IF NOT EXISTS idx_chat_messages_author_created
    ON chat_messages (author_user_id, created_at DESC)
    WHERE author_user_id IS NOT NULL;

-- Workspace — listagens recentes de actividade
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace_created
    ON chat_messages (workspace_id, created_at DESC);

-- Mensagens ligadas a um snapshot (rollback / diff / audit)
CREATE INDEX IF NOT EXISTS idx_chat_messages_version
    ON chat_messages (project_version_id)
    WHERE project_version_id IS NOT NULL;

-- Pesquisa full-text em prompts (português)
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS content_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_chat_messages_content_tsv
    ON chat_messages USING GIN (content_tsv);

-- Pesquisa fuzzy (autocomplete / typo-tolerant)
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_trgm
    ON chat_messages USING GIN (content gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_chat_conversations_updated_at
    BEFORE UPDATE ON chat_conversations FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- Função auxiliar: rollback para uma versão anterior (cria nova versão "rollback")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rollback_project_to_version(
    p_project_id UUID,
    p_target_version_id UUID,
    p_user_id UUID,
    p_summary TEXT DEFAULT 'Rollback'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_id UUID;
    v_next_num INTEGER;
    v_parent UUID;
    v_hash CHAR(64);
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM project_versions
        WHERE id = p_target_version_id AND project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'Versão % não pertence ao projecto %', p_target_version_id, p_project_id;
    END IF;

    SELECT version_number, snapshot_hash, parent_version_id
    INTO v_next_num, v_hash, v_parent
    FROM project_versions
    WHERE id = p_target_version_id;

    SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_num
    FROM project_versions WHERE project_id = p_project_id;

    UPDATE project_versions SET is_head = FALSE WHERE project_id = p_project_id AND is_head = TRUE;

    INSERT INTO project_versions (
        project_id, version_number, parent_version_id, created_by_user_id,
        summary, source, snapshot_hash, file_manifest, is_head
    )
    SELECT
        p_project_id,
        v_next_num,
        p_target_version_id,
        p_user_id,
        p_summary,
        'rollback',
        pv.snapshot_hash,
        pv.file_manifest,
        TRUE
    FROM project_versions pv
    WHERE pv.id = p_target_version_id
    RETURNING id INTO v_new_id;

    INSERT INTO project_version_files (version_id, path, content, content_hash, size_bytes, lang)
    SELECT v_new_id, path, content, content_hash, size_bytes, lang
    FROM project_version_files
    WHERE version_id = p_target_version_id;

    UPDATE projects
    SET current_version_id = v_new_id, updated_at = NOW()
    WHERE id = p_project_id;

    RETURN v_new_id;
END;
$$;

COMMIT;
