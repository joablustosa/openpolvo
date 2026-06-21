# Prompt — Open Polvo Desk MVP v0.1

> Spec de produto + engenharia para o primeiro release funcional. Baseado no monorepo `openpolvomonorepo` existente.

---

## Prompt (copiar para agentes / Linear project description)

```
Tu és o engenheiro responsável pelo Open Polvo Desk MVP v0.1 — a primeira versão
utilizável da visão "Linux dos Agentes": um agente local que conversa com o
utilizador e usa ferramentas no computador (ficheiros, terminal, git) numa
interface desktop simples.

## Missão v0.1

Entregar em semanas, não meses: um utilizador abre o Open Polvo Desk, escolhe
uma pasta de trabalho, selecciona Ollama (ou opcionalmente OpenAI/Anthropic),
conversa em Agent Mode, vê o agente pensar/agir/observar, e as tools executam
localmente com confinamento de paths. Code Mode mostra/edita o projecto;
Flow Mode existe só como shell vazio para v0.2.

## O que JÁ existe no repo (reutilizar)

Monorepo em 3 stacks HTTP/JSON:

- openpolvo/ — React 19 + Vite + Electron (Dev Studio, polvoCode IPC, chat)
- openpolvobackend/ — Go hexagonal (conversas, auth, agent adapter)
- openpolvointeligence/ — Python LangGraph + FastAPI (Zé Polvinho, dev_workflow)

Reutilizar directamente:
- **LangGraph** — padrão do repo: `StateGraph`, `*_state.py`, nós async, `build_*_graph(settings)`
- **Orquestração existente** — `zepolvinho_graph.py` (`run_reply`, `run_reply_stream`), `message_utils`, `agent_memory_utils`
- IPC Electron: readFile, writeFile, listDir, safePathUnderRoot (polvoCode.cjs)
- Conversas + streaming: ConversationWorkspaceContext, POST /v1/reply/stream
- Memória: agent_memory_patch (global + builder) em SQLite
- Modelos: graphs/models.py (OpenAI + Google) — estender, não apagar
- Dev Studio: base para Code Mode

## O que NÃO entra no v0.1

Multiagente, dev_workflow teams, code RAG/pgvector, marketplace, cloud,
plugins SMTP/Meta, finanças, social, workflows Playwright, skills markdown
complexas, knowledge graph. DESK_MVP_MODE oculta estas áreas na UI.

## Arquitectura MVP (5 camadas + Desk)

### 1. Runtime Core (openpolvointeligence) — LangGraph obrigatório

**Invariante:** o MVP **não regrede** — todo o runtime Desk é um grafo LangGraph
compilado, no mesmo estilo de `zepolvinho_graph.py` e `dev_workflow_graph.py`.
Proibido loop imperativo ou classe `AgentRuntime` paralela ao LangGraph.

Novo subgrafo `desk_graph/` em `openpolvointeligence/graphs/`:

| Ficheiro | Responsabilidade |
|----------|------------------|
| `desk_state.py` | `DeskAgentState` (`TypedDict`) — messages, tool_calls, trace, workspace_path, iteration |
| `desk_graph.py` | `build_desk_graph(settings)` → grafo compilado |
| `desk_tools.py` | Schemas + registry das 3 tools (fs, terminal, git) |
| `desk_tool_logic.py` | Execução determinística (zero-token), timeout, serialização |
| `desk_routing.py` | `should_use_desk_graph(desk_context)` — função pura testável |
| `prompts/desk_agent_system.md` | System prompt do nó agent |

**Topologia do grafo (ReAct via LangGraph):**

```
START → load_context → agent → [tools?] → agent → … → finalize → END
              ↑___________________|
         (max 10 iterações, contador no state)
```

- **load_context** — trim mensagens, inject memória workspace (zero-token)
- **agent** — LLM com `bind_tools`; emite AIMessage + tool_calls ou resposta final
- **tools** — nó que executa tools registadas; append ToolMessage ao state
- **finalize** — `assistant_text`, `metadata`, `trace` (como `dev_workflow_state.truncate_trace`)
- **Conditional edge** — `tools` se houver tool_calls e `iteration < max`; senão `finalize`

Entrada/saída espelha Zé Polvinho:

- `run_desk_reply(settings, …)` / `run_desk_reply_stream(…)` — paridade com `run_reply_stream`
- Roteamento na API: `desk_context` presente → `desk_graph`; senão fluxo actual (ou bloqueado em `DESK_MVP_MODE`)

Eventos SSE (stream): `agent_event` por nó/transição — `thought | tool_call | tool_result | graph_step | final`

### 2. Model Layer

- Provider default: Ollama (langchain-community ChatOllama)
- Opcional: OpenAI, Anthropic (env flags)
- Interface única: get_chat_model(settings, provider) — já em graphs/models.py
- /readyz reporta Ollama reachable

### 3. Tools Layer

Três tools MVP, schemas JSON para function calling:

| Tool | Execução | Segurança |
|------|----------|-----------|
| filesystem | Electron IPC existente | Só under workspace root |
| terminal | Novo IPC deskTerminal | cwd=workspace, timeout 60s, denylist rm -rf |
| git | Novo IPC deskGit | read-only default; commit só com flag explícita |

Intelligence pede execução ao backend; backend valida sessão; Electron executa.

### 4. Memory Layer

- Histórico: tabela messages (já existe)
- Persistente: agent_memory { global, workspace } — adaptar builder→workspace
- Contexto: últimas 20 msgs + memória truncada 4k tokens
- Sem embeddings no v0.1

### 5. Open Polvo Desk (openpolvo)

Modos (tabs top-level):

- **Agent Mode** (default): chat + AgentLogPanel (thought/tool/observation)
- **Code Mode**: DevStudioPanel enxuto (preview + editor inline)
- **Flow Mode**: placeholder "Em breve" — só layout, zero lógica

Outros:
- Selector workspace (pasta)
- Selector modelo (Ollama primeiro)
- Logs persistidos em desktopLogs (já existe)

## Contrato HTTP MVP (congelar em DESK-0)

POST /v1/reply/stream body mínimo:
{
  "messages": [...],
  "model_provider": "ollama" | "openai" | "anthropic",
  "desk_context": {
    "mode": "agent" | "code",
    "workspace_path": "/abs/path",
    "conversation_id": "uuid"
  }
}

SSE events:
- delta (texto assistant)
- agent_event { type, payload }
- done { metadata }

## Critérios de aceite v0.1

1. Arranque local 3 stacks < 2 min (doc M0)
2. Ollama responde sem chave cloud
3. Utilizador: "lista ficheiros src/" → agent chama filesystem → resposta correcta
4. Utilizador: "git status" → output real do repo
5. Reiniciar app → conversa + memória workspace recuperadas
6. Agent Mode mostra log de cada tool call
7. Instalador desktop desk-v0.1.0 tag

## Princípios de implementação

- **LangGraph first** — StateGraph + estado tipado + nós finos; lógica determinística fora dos nós LLM (`python-intelligence-standards`)
- Diff mínimo; código limpo; gates por stack (tsc, go test, pytest)
- Testes: `desk_routing`, `desk_tool_logic`, nós do grafo com state mock (sem LLM real)
- Português na UI; commits convencionais
- Cada entrega mapeia a um card Linear (skill linear-desk-mvp-sync)

## Anti-padrões (não regredir)

- ❌ Loop `while` think/act/observe fora do LangGraph
- ❌ Substituir LangGraph por orquestrador Go ou script ad-hoc
- ❌ Copiar o grafo completo do Zé Polvinho (20+ especialistas) no Desk
- ❌ Tool execution inline dentro do nó agent (separar nó `tools`)

## Ordem de entrega

M0 contrato → M1 runtime+Ollama → M2 tools → M3 memória → M4 Desk UI → M5 release
```

---

## Notas de alinhamento com o repo

| Camada MVP | Estado actual | Gap principal |
|------------|---------------|---------------|
| Runtime | LangGraph (`zepolvinho_graph`, `dev_workflow_graph`) | Novo `desk_graph` ReAct com tools locais |
| Model | OpenAI + Google | Ollama + Anthropic |
| Tools | polvoCode fs parcial | terminal + git + nó LangGraph `tools` |
| Memory | messages + agent_memory | Nó `load_context` + workspace no state |
| Desk | Chat + Dev Studio | Modes Agent/Code/Flow + stream de nós |

Este documento é a referência da skill `linear-desk-mvp-sync`.

**Setup Linear (epics, issues, sub-issues):** ver [`linear-desk-mvp-setup.md`](linear-desk-mvp-setup.md).
