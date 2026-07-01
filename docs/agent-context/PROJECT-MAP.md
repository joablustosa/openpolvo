# PROJECT-MAP — Mapa arquitetural do OpenPolvo

> Contexto profundo do projeto para agentes. Atualize quando a arquitetura mudar.
> Última revisão: 2026-07-01.

## 1. Fluxo de um turno (Agent/Code Mode)

```
polvocode (Electron)
  └─ POST /v1/conversations/{id}/messages/stream        (cliente → Go)
       backend Go: carrega histórico + agent_memory (SQLite), monta ReplyRequest
        └─ POST /v1/reply/stream                          (Go → Intelligence)
             Intelligence: desk_context.mode ∈ {agent,code} → desk_graph (ReAct)
               ├─ emite SSE agent_event: graph_step | thought | tool_call | tool_result | final
               ├─ tool_call requires_client=true → bridge (Future) aguarda o cliente
               │    cliente executa via IPC → POST /desk-tool-result → bridge.submit
               └─ done: assistant_text + metadata (pode conter agent_memory_patch)
       Go persiste mensagens + aplica agent_memory_patch (ApplyAgentMemoryPatch)
```

Contrato canónico: [`docs/desk-api-contract.md`](../desk-api-contract.md).

## 2. Intelligence (Python) — `openpolvointeligence/src/openpolvointeligence/`

### graphs/
- `desk/` — Agent/Code Mode. `desk_graph.py` (ReAct), `desk_tool_logic.py` (fs/terminal/git,
  path-traversal guard, denylist+timeout no terminal), `desk_tool_bridge.py` (Future+timeout
  para execução no cliente), `desk_routing.py`, `desk_state.py`.
- `dev_workflow/` — motor de desenvolvimento multi-passo (o "cérebro" pesado):
  - `agents/runners.py` — **17+ runners**: requirements, stack_selector, impact_analyzer,
    architect, frontend, backend, database, auth, devops, test, edit, debug, refactor,
    api_design, review, delete, code_executor, context_loader, legacy_core.
  - `agents/agent_loop_runner.py` + `engines/agent_loop/` — loop agentico ReAct nativo.
  - `engines/` — `context`, `patch`, `router` (matriz modelo×nó), `memory`, `semantic`,
    `symbols` (symbol graph), `ast`, `planner`, `repair` (self-healing), `execution`.
  - `integrations/mcp/registry.py` — MCP (bridge inicial). `integrations/plugins/skills_loader.py`.
  - `tools/` — filesystem, git, terminal_port, linter, type_checker, code_executor,
    dependency, migration, file_output_parser.
  - `docs/` — **30 docs de design** (00-VISION … 29-CONTRIBUTING). Ler antes de mexer no motor.
  - `core/` — dev_gateway_graph, dev_workflow_planning, dev_workflow_routing, request_kind.
- `orchestrator/` — `zepolvinho_graph.py` roteia intenção → subgrafo. `native_plugins.py`.
- `conversation/`, `web_research/`, `pdf_read`, `pdf_study`, `xlsx_full`, `documents_full`,
  `email`, `social`, `workflow_builder/` — subgrafos de domínio.
- `models.py` — resolução de provider (OpenAI/Google/Anthropic/Ollama) com fallback resiliente.
- `agent_memory_utils.py` — blocos de memória (global/builder).

### core/config.py — flags importantes (pydantic-settings)
- Providers: `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, Ollama (`OLLAMA_*`).
- Desk: `DESK_ALLOW_CLOUD_PROVIDERS`, `desk_default_provider` (default `ollama`).
- Web: `SERPAPI_API_KEY`, `WEB_RESEARCH_MAX_DEEP_URLS`, `WEB_FETCH_*` (trafilatura).
- RAG: `CODE_RAG_DATABASE_URL` (pgvector), `CODE_RAG_EMBEDDING_MODEL`, `CODE_RAG_AUTO_INDEX`.
- Dev teams: `DEV_WORKFLOW_TEAM_MODE`, `DEV_WORKFLOW_MAX_REVIEW_ROUNDS`,
  `DEV_WORKFLOW_BUILD_SANDBOX_*`, `DEV_WORKFLOW_ERROR_MEMORY_ENABLED`,
  `DEV_WORKFLOW_AGENT_LOOP_*`, `DEV_WORKFLOW_SUBAGENTS_ENABLED`, `DEV_WORKFLOW_NATIVE_TOOLS`.

## 3. Backend (Go, hexagonal) — `openpolvobackend/internal/`

Contextos DDD: `agent` (orquestra Intelligence: `adapters/polvointel/`), `conversations`,
`identity`, `llmprofiles` (perfis/keys de provider), `mail`, `finance`, `contacts`, `meta`.
Cada contexto: `application/` (casos de uso), `ports/` (interfaces), `adapters/` (impl),
`domain/`. HTTP em `internal/transport/http` só orquestra — sem regra de negócio no handler.

## 4. Frontend — `polvocode/`

Fork do VS Code OSS + Electron. Janela de agente em `src/vs/sessions/`. Padrões TS do VS Code;
tokens de design (skills `ux-css-layout`, `ux-theming`). Ver `polvocode/OPENPOLVO.md`.

## 5. Providers LLM (llama local + keys)

- `models.py::resolve_chat_provider` — se há key do provider pedido usa-a; senão faz
  fallback para outro com key; por fim Ollama (se acessível). `desk_effective_provider`
  força Ollama por defeito no Desk (cloud só com `DESK_ALLOW_CLOUD_PROVIDERS`).
- `engines/router/matrix.py` — por nó do grafo escolhe tier (fast/balanced/strong).
  Hoje mapeia strong→openai, fast→google (extensível p/ deepseek/qwen/local — ver roadmap).
- Keys do utilizador: geridas em `llmprofiles` (Go) → propagadas ao Intelligence via body/env.

## 6. Onde ler mais

- Capacidades atuais: [`CAPABILITIES.md`](CAPABILITIES.md).
- Gaps p/ paridade Claude/Cursor + roadmap: [`PARITY-ROADMAP.md`](PARITY-ROADMAP.md).
- Diário de mudanças dos agentes: [`JOURNAL.md`](JOURNAL.md).
- Design profundo do motor dev: `openpolvointeligence/.../dev_workflow/docs/`.
