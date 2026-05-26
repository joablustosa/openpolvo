# Code RAG — Geração Aumentada por Recuperação de Código

Estratégia para projectos grandes: **indexar** funções/componentes/rotas em **pgvector** e o **Router LangGraph** recupera só ficheiros relevantes (ex.: auth → `middleware.ts`, `supabase/client.ts`), ignorando o resto do app.

## Fluxo

```mermaid
sequenceDiagram
    participant FS as Project Files
    participant IDX as Indexer
    participant PG as pgvector
    participant R as Router Node
    participant A as Architect

    FS->>IDX: chunker (config/route/component)
    IDX->>PG: embeddings OpenAI
    Note over R: user prompt "NextAuth Supabase"
    R->>PG: semantic search (config+route first)
    PG-->>R: top 8 chunks
    R->>R: rag_context_block (~4.5k chars)
    R->>A: rag_relevant_paths only
```

## Setup PostgreSQL

```bash
psql "$CODE_RAG_DATABASE_URL" -f openpolvobackend/schema/postgres/002_code_rag_pgvector.up.sql
pip install -e ".[rag]"
```

Variáveis (`openpolvointeligence/.env`):

```env
CODE_RAG_DATABASE_URL=postgresql://user:pass@localhost:5432/openpolvo
CODE_RAG_EMBEDDING_MODEL=text-embedding-3-small
CODE_RAG_ROUTER_TOP_K=8
CODE_RAG_AUTO_INDEX=true
OPENAI_API_KEY=sk-...
```

Sem Postgres: fallback **InMemoryVectorStore** (dev/testes).

## CLI — varrer repositório

```bash
cd openpolvointeligence
python -m openpolvointeligence.code_rag.cli index \
  --root ../meu-app \
  --project-id 550e8400-e29b-41d4-a716-446655440000

python -m openpolvointeligence.code_rag.cli query \
  --project-id 550e8400-e29b-41d4-a716-446655440000 \
  --prompt "Adicione autenticação via NextAuth/Supabase Auth"
```

## API Intelligence

- `POST /v1/dev-studio/code-rag/index` — `{ project_id, project_files }`
- `POST /v1/dev-studio/code-rag/query` — `{ project_id, prompt, top_k }`

## Integração LangGraph Router

Antes do LLM Router (`dev_workflow_graph.node_router`):

1. `index_project_files` (se `CODE_RAG_AUTO_INDEX` e `project_files` presentes)
2. `retrieve_for_router` — duas passagens:
   - **config + route** (middleware, auth routes, env)
   - componentes/funções do domínio detectado
3. Inject `rag_context_block` no human message
4. Reduz `project_file_tree` aos paths recuperados
5. Architect faz `_prune_to_rag_scope` — não planea ficheiros fora do RAG

## Tipos de chunk

| Tipo | Exemplos |
|------|----------|
| `config` | `middleware.ts`, `next.config`, `.env`, `package.json` |
| `route` | `app/api/auth/...`, `routes.ts`, handlers Go |
| `component` | `.tsx` export default |
| `function` / `hook` | funções exportadas, `useAuth` |

## Economia de tokens

| Sem RAG | Com RAG |
|---------|---------|
| Manifesto 80+ paths | 6–12 paths |
| Context map completo | Excerpts ~900 chars/chunk |
| Architect planifica tudo | Scope bloqueado por `rag_relevant_paths` |
