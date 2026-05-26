-- Code RAG — embeddings de funções/componentes/rotas (pgvector)
-- Requer: PostgreSQL 15+ e extensão pgvector

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS code_rag_index_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    files_scanned   INTEGER NOT NULL DEFAULT 0,
    chunks_indexed  INTEGER NOT NULL DEFAULT 0,
    chunks_skipped  INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'completed',
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_code_rag_index_runs_project
    ON code_rag_index_runs (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS code_rag_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    path            TEXT NOT NULL,
    chunk_type      TEXT NOT NULL,  -- config | route | component | function | hook | module
    symbol_name     TEXT,
    start_line      INTEGER NOT NULL DEFAULT 1,
    end_line        INTEGER NOT NULL DEFAULT 1,
    layer           TEXT,           -- frontend | backend | shared
    content_hash    CHAR(64) NOT NULL,
    content         TEXT NOT NULL,  -- texto embedado (path + símbolos + excerpt)
    embedding       vector(1536) NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_code_rag_chunk_type CHECK (
        chunk_type IN ('config', 'route', 'component', 'function', 'hook', 'module', 'type')
    ),
    CONSTRAINT ck_code_rag_layer CHECK (
        layer IS NULL OR layer IN ('frontend', 'backend', 'shared')
    )
);

-- Upsert por projecto + path + símbolo + linha
CREATE UNIQUE INDEX IF NOT EXISTS uq_code_rag_chunks_identity
    ON code_rag_chunks (project_id, path, COALESCE(symbol_name, ''), start_line);

CREATE INDEX IF NOT EXISTS idx_code_rag_chunks_project_type
    ON code_rag_chunks (project_id, chunk_type);

CREATE INDEX IF NOT EXISTS idx_code_rag_chunks_project_path
    ON code_rag_chunks (project_id, path);

-- HNSW — busca semântica rápida (cosine)
CREATE INDEX IF NOT EXISTS idx_code_rag_chunks_embedding_hnsw
    ON code_rag_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Busca por projecto + tipo (Router filtra config/route primeiro)
CREATE INDEX IF NOT EXISTS idx_code_rag_chunks_project_layer
    ON code_rag_chunks (project_id, layer, chunk_type);

COMMIT;
