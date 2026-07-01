# CAPABILITIES — Inventário de capacidades do OpenPolvo

> O que **já existe** vs **planeado**. Ao entregar uma capacidade, mova-a de
> "Planeado" para "Implementado" e registe no [`JOURNAL.md`](JOURNAL.md).
> Última revisão: 2026-07-01.

## ✅ Implementado

### Núcleo agentico
- Agente ReAct local (Agent/Code Mode) via `desk_graph` com tool-bridge para o cliente.
  ✅ **Transparência (2026-07-01):** emite `graph_step` + `thought` (raciocínio visível) e
  tem **guarda de loop improdutivo** (corta tool+args repetida 3× seguidas). Falta só
  streaming token-a-token (`delta`).
- Loop agentico nativo (`engines/agent_loop/`) com limite de iterações.
- Orquestrador de intenção (`orchestrator/zepolvinho_graph.py`) → subgrafos de domínio.

### Times de agente (multi-agent)
- **17+ agentes especializados** (architect, frontend, backend, database, auth, devops,
  test, debug, refactor, review, impact_analyzer, requirements, api_design…).
- **Team mode** worker+revisor por etapa (`DEV_WORKFLOW_TEAM_MODE`, review rounds).
- **Subagentes** (`DEV_WORKFLOW_SUBAGENTS_ENABLED`).

### Correção de bugs / qualidade
- **Bug-fix team em 1 comando** (2026-07-01): fluxo `debug` fecha detect→fix→verify.
  `triage` (detect determinístico: categoria + sinal de erro + suspeitos + error-memory)
  → fix (agent_loop/legacy_core) → verify (type_check↔corrective + tests + **build graceful**)
  → `delivery_gate` (repair loop bounded) → **relatório estruturado** (`bugfix_report`).
  Reusa runners + repair + sandbox. Flag `DEV_WORKFLOW_DEBUG_BUILD_CHECK`. Sem alterar
  os outros workflows. Arquivos: `agents/bugfix_triage.py`, `workflows/debug_workflow.py`.
- **Self-healing**: corrective agent ↔ type_check ↔ compiler_checker ↔ self_healer (`engines/repair/`).
- **Build sandbox real** (tsc/vite) como portão anti-bug (`DEV_WORKFLOW_BUILD_SANDBOX_*`).
- **Memória de erros** (RAG erro→fix por conversa/projeto, `DEV_WORKFLOW_ERROR_MEMORY_ENABLED`).
- Linter + type_checker como tools.

### Contexto / RAG / memória
- **Code RAG** (pgvector + embeddings, auto-index) — `code_rag/`.
- **Symbol graph** + AST + engine semântico (`engines/symbols`, `engines/ast`, `engines/semantic`).
- Memória persistente por conversa (blocos global/builder + `agent_memory_patch` idempotente).
- Checkpoints (`engines/` + docs 16-CHECKPOINTS).

### Tools locais
- Filesystem (path-traversal guard), terminal (denylist + timeout + confirmação no cliente),
  git local, code_executor, dependency, migration.

### Multi-provider (llama local + keys)
- OpenAI, Google, Anthropic, **Ollama** com fallback resiliente (`models.py`).
- Router de modelo por nó (fast/balanced/strong) — `engines/router/matrix.py`.
- Keys geridas em `llmprofiles` (Go).

### Pesquisa web
- SerpAPI + subgrafo `web_research` multi-etapa + `web_fetch` (trafilatura).
- ✅ **Exposto como tool ao agente de código** (2026-07-01): `web_search` + `web_fetch`
  disponíveis no agente Desk (`desk_graph`) e no loop de dev (`agent_loop`), execução
  server-side, read-only, com guard SSRF. Fonte única em `graphs/web_research/web_tools.py`.
  Flags: `OP_WEB_TOOLS_ENABLED`, `WEB_SEARCH_MAX_RESULTS`. Funciona com Ollama e com keys.

### Git & GitHub (via gh)
- ✅ **Git + GitHub como tools do agente** (2026-07-01): git `branch`, `checkout`,
  `pull`, `push`, `add`, `clone`, `log` + `github` (gh: PR, issues, checks, repo) no
  agente Desk; `github` também no loop de dev. Política default-deny + classificação
  read/write + **gate de aprovação** (`requires_approval` no fluxo bridge; bloqueio
  server-side de ações perigosas; escrita local só com `VCS_ALLOW_WRITE`). `push --force`
  e `repo delete`/`secret`/`auth login-logout` bloqueados. Fonte: `graphs/vcs/`.
  Flags: `OP_GITHUB_TOOLS_ENABLED`, `VCS_ALLOW_WRITE`, `DESK_GIT_ALLOW_COMMIT` (retrocompat).

### Automações (Workflow Mode) — end-to-end
- ✅ Sistema de automação completo: backend `internal/workflows` (engine com nós
  `schedule`/`web_search`/`send_email`/`llm`/social; scheduler ligado por omissão +
  schedulequeue); API `/v1/workflows` (CRUD + `/generate` NL→grafo + `/run` + `/runs`);
  SMTP `/me/smtp` (+comando `polvo.settings.smtp` no front); frontend `polvoModes`
  (modo "Automações" + canvas + service sincronizado).
- ✅ **Template "Pesquisa → E-mail" 1 clique** (2026-07-01): `internal/workflows/domain/templates.go`
  + `GET /v1/workflows/templates` + botão de exemplo no painel. Deps: SERPAPI + SMTP.
- ✅ Nó `llm` do engine expande `{{previous}}`/`{{output:ID}}` (permite research→resumo→email).
- Guia: `docs/agent-context/GUIA-AUTOMACOES.md`.

### Extensibilidade
- MCP registry inicial (`integrations/mcp/registry.py`).
- Skills/plugins loader (`integrations/plugins/skills_loader.py`, lê `.cursor/skills/**`).
- Streaming SSE completo (`agent_event`).

## 🟡 Parcial / a amadurecer
- MCP: só bridge inicial — falta cliente MCP completo (conectar servidores externos).
- Router multi-modelo: hardcoded openai/google; falta DeepSeek/Qwen e tiers p/ modelos locais.

## ⛔ Ausente (ver PARITY-ROADMAP)
- PR review automatizado (comentar diffs/sugerir fixes) — A5, P2.
- UI de aprovação no frontend `polvocode` (o backend já emite `requires_approval`) — D2.
- LSP / diagnostics em tempo real como sinal para o agente.
- @-mentions de contexto (@file/@symbol/@web) no chat estilo Cursor.
- Apply/diff review UI com aceitar/rejeitar por hunk + undo/checkpoint por edição.
