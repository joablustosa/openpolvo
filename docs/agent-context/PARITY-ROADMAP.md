# PARITY-ROADMAP — Paridade com Claude Code e Cursor

> Lista de integrações/funcionalidades que Claude Code e Cursor oferecem, mapeadas
> contra o estado do OpenPolvo, com prioridade. Atualize o **Estado** ao entregar.
> Legenda estado: ✅ feito · 🟡 parcial · ⛔ ausente. Última revisão: 2026-07-01.

## Como priorizamos
`P0` = maior impacto/UX com menor custo, destrava o resto. `P1` = alto valor.
`P2` = diferencial. Cada item deve funcionar com **Ollama local E keys de provider**.

---

## A. Integrações externas

| # | Integração | Claude | Cursor | OpenPolvo | Prio |
|---|-----------|:------:|:------:|:---------:|:----:|
| A1 | **GitHub via terminal/`gh`** (clone, branch, commit, push/pull, criar PR, issues, ver checks) | ✅ | ✅ | ✅ (2026-07-01) | **P0** |
| A2 | **Web search como tool do agente** (buscar docs/erros quando precisa) | ✅ | ✅ (@web) | ✅ (2026-07-01) | **P0** |
| A3 | **Web fetch de URL** como tool (ler página/doc indicada) | ✅ | ✅ | ✅ (2026-07-01) | P1 |
| A4 | **MCP client completo** (conectar servidores MCP externos: DBs, Slack, Linear…) | ✅ | ✅ | 🟡 registry inicial | P1 |
| A5 | **PR review automatizado** (comentar diffs, sugerir fixes) | ✅ | ✅ | ⛔ | P2 |
| A6 | Issue → tarefa de agente (pegar issue e resolver) | 🟡 | 🟡 | ⛔ | P2 |

## B. Capacidades do agente de código

| # | Funcionalidade | Claude | Cursor | OpenPolvo | Prio |
|---|---------------|:------:|:------:|:---------:|:----:|
| B1 | **Team de agentes p/ corrigir bugs** (detectar→localizar→corrigir→verificar) | ✅ | ✅ | ✅ (2026-07-01) | **P0** |
| B2 | **@-mentions de contexto** (@file, @folder, @symbol, @web) no chat | 🟡 | ✅ | ⛔ | P1 |
| B3 | **LSP/diagnostics** como sinal para o agente (erros do editor em tempo real) | ✅ | ✅ | ⛔ | P1 |
| B4 | **Apply/diff review** com aceitar/rejeitar por hunk | ✅ | ✅ | 🟡 patch engine existe | P1 |
| B5 | **Checkpoints/undo por edição** (reverter passo do agente) | ✅ | ✅ | 🟡 engine existe | P1 |
| B6 | **Rules de projeto** (`AGENTS.md`/`.cursorrules`/skills) injetadas no contexto | ✅ | ✅ | ✅ skills_loader | ✅ |
| B7 | **Codebase indexing/semantic search** p/ contexto automático | ✅ | ✅ | ✅ Code RAG + symbol graph | ✅ |
| B8 | **Executar testes e ler resultados** no loop | ✅ | ✅ | ✅ test agent + sandbox | ✅ |
| B9 | **Terminal integrado** com confirmação e streaming | ✅ | ✅ | ✅ desk terminal | ✅ |
| B10 | **Tab/autocomplete preditivo** (Cursor Tab) | ⛔ | ✅ | ⛔ | P2 |

## C. Modelos e roteamento

| # | Funcionalidade | Estado OpenPolvo | Prio |
|---|---------------|:----------------:|:----:|
| C1 | Multi-provider (OpenAI/Google/Anthropic/Ollama) com fallback | ✅ | ✅ |
| C2 | **Router por tarefa (fast/balanced/strong)** com DeepSeek/Qwen/local | 🟡 hardcoded openai/google | **P0** |
| C3 | UI para o utilizador colar keys e escolher modelo por modo | 🟡 llmprofiles existe | P1 |
| C4 | Streaming de tokens e custo/uso por turno | 🟡 | P2 |

## D. UX (nível Claude/Cursor)

| # | Funcionalidade | Estado | Prio |
|---|---------------|:------:|:----:|
| D1 | Raciocínio + tool_calls visíveis e colapsáveis | 🟡 eventos existem, render? | P1 |
| D2 | Gate de aprovação p/ ações sensíveis (comando/diff exato) | 🟡 confirmação terminal | P1 |
| D3 | Interromper/retomar turno | 🟡 | P1 |
| D4 | Histórico de sessões + retomar contexto | ✅ conversas SQLite | ✅ |

---

## Sequência recomendada (sprints)

**Sprint 1 (P0) — "agente que trabalha como Claude no terminal"**
1. ~~**A1 GitHub via `gh`**~~ ✅ **FEITO (2026-07-01)** — git (branch/checkout/pull/push/add/
   clone/log) + `github` (gh) no desk e loop; política default-deny em `graphs/vcs/`,
   gate de aprovação (`requires_approval` + bloqueio server-side), 26 testes. Falta a
   **UI de aprovação** no frontend (D2) e **PR review automatizado** (A5).
2. ~~**A2 Web search tool**~~ ✅ **FEITO (2026-07-01)** — `web_search`+`web_fetch` server-side
   no desk_graph e no agent_loop; fonte única `graphs/web_research/web_tools.py`; 14 testes.
3. **C2 Router multi-modelo**: tornar `engines/router/matrix.py` orientado a config
   (adicionar deepseek/qwen/local; tiers configuráveis por env/perfil).
4. ~~**B1 Bug-fix team**~~ ✅ **FEITO (2026-07-01)** — fluxo `debug` fecha
   detect(triage)→fix→verify(tsc/tests/build graceful)→repair loop→relatório
   (`bugfix_report`). Reusa runners+repair+sandbox; não altera outros workflows. 11 testes.

**Sprint 2 (P1)**: A4 MCP client · B3 LSP diagnostics · B2 @-mentions · B4 apply/diff · C3 UI de keys.

**Sprint 3 (P2)**: A5 PR review · A6 issue→agente · B10 Tab · C4 custo/uso · B5 checkpoints UI.

## Regras de implementação (todos os itens)
- Funciona com **Ollama local** e com **keys** — testar os dois caminhos.
- Tool de efeito externo (push, PR, comando) → **gate de aprovação** + allowlist.
- Sem LLM real em teste; portão da stack antes de concluir.
- Contrato HTTP/JSON congelado antes de tocar 2 stacks (skill `parallel-dev-orchestrator`).
- Ao concluir: atualizar `CAPABILITIES.md`, este arquivo e `JOURNAL.md`.
