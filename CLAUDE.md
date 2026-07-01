# CLAUDE.md — Contexto mestre do OpenPolvo

> Arquivo carregado automaticamente por agentes (Claude Code) no arranque. É o
> **ponto de entrada de contexto** do projeto. Mantenha-o curto e aponte para os
> docs detalhados em [`docs/agent-context/`](docs/agent-context/).

## O que é o OpenPolvo

Agente de desenvolvimento **local** para desktop (concorrente direto de Claude Code
e Cursor), monorepo de 3 stacks que falam por **HTTP/JSON**:

| Pasta | Stack | Papel |
|-------|-------|-------|
| `polvocode` | VS Code OSS + Electron (TS) | IDE/frontend oficial (`src/vs/sessions/` = janela de agente) |
| `openpolvobackend` | Go 1.25, hexagonal | API, conversas, memória (SQLite), perfis LLM |
| `openpolvointeligence` | Python 3.11, LangGraph + FastAPI + RAG | Cérebro: grafos de agente, workflows, RAG |

Modos: **Agent** (chat+tools), **Code** (dev no workspace), **Workflow** (automação NL).

## Onde está a inteligência (mapa rápido)

- **Agent/Code Mode** → `openpolvointeligence/.../graphs/desk/desk_graph.py` (ReAct + tool-bridge).
- **Dev multi-passo** → `.../graphs/dev_workflow/` — 17+ agentes, team mode, self-healing,
  12 engines (`engines/`), 30 docs de design (`dev_workflow/docs/`).
- **Workflow Mode** → `.../graphs/workflow_builder/`.
- **Providers LLM** → `.../graphs/models.py` (OpenAI/Google/Anthropic/Ollama, fallback resiliente)
  + `engines/router/matrix.py` (tier por nó: fast/balanced/strong).
- **Contrato entre stacks** → `docs/desk-api-contract.md` (SSE `agent_event`, `desk_context`, memória).

Detalhe completo: [`docs/agent-context/PROJECT-MAP.md`](docs/agent-context/PROJECT-MAP.md).

## Skills (padrões obrigatórios)

- Transversais (agente/workflow agentico): [`.claude/skills/`](.claude/skills/README.md).
- Por stack: `openpolvobackend/.cursor/skills/`, `polvocode/.github/skills/`, e o
  `AGENTS.md` de cada pasta. Cross-stack → skill `parallel-dev-orchestrator`.

## Portões de qualidade (antes de concluir qualquer mudança)

| Stack | Portão |
|-------|--------|
| Intelligence | `ruff check` + `ruff format --check` + `pytest` (asyncio_mode=auto; **nunca LLM real em teste**) |
| Backend | `gofmt` / `go vet ./...` + `go build ./...` + `go test ./...` |
| Frontend | `npm run transpile-client` |

## Princípios não-negociáveis

1. Camada determinística primeiro; LLM só para ambiguidade real de linguagem.
2. State tipado; **sem erros engolidos** (`except: pass` proibido) — falha é valor.
3. Contexto mínimo via RAG; orce tokens. Nunca despeje o repo inteiro.
4. Contrato HTTP/JSON congelado antes de implementar cross-stack.
5. UX transparente: streaming, raciocínio visível, gate para ações sensíveis.

## ⚠️ Protocolo de manutenção de contexto (LEIA)

**Sempre que fizer uma melhoria, fix, nova integração ou decisão de arquitetura**,
antes de encerrar a tarefa atualize:

1. [`docs/agent-context/JOURNAL.md`](docs/agent-context/JOURNAL.md) — 1 entrada
   (data, o quê, porquê, arquivos tocados). É o diário append-only.
2. [`docs/agent-context/CAPABILITIES.md`](docs/agent-context/CAPABILITIES.md) — se
   adicionou/alterou uma capacidade, mova a linha de "planeado" → "implementado".
3. [`docs/agent-context/PARITY-ROADMAP.md`](docs/agent-context/PARITY-ROADMAP.md) —
   marque o item entregue e ajuste prioridades.
4. `CHANGELOG.md` (raiz) — se for mudança visível ao utilizador.
5. Este `CLAUDE.md` — só se mudou o mapa de alto nível.

Manter estes arquivos vivos é parte da definição de "pronto".
