# OpenPolvo — Guia para Agentes

Monorepo de um **agente de desenvolvimento** e de **automação/workflows com RAG**. Três stacks independentes que se comunicam por API HTTP/JSON.

## Stacks e padrões

| Stack | Pasta | Skill obrigatório |
|-------|-------|-------------------|
| Frontend (React 19 + Vite + Electron) | `openpolvo` | `react-frontend-standards` + `frontend-design-system` |
| Backend (Go 1.25, hexagonal) | `openpolvobackend` | `golang-backend-standards` |
| Intelligence (Python 3.11, LangGraph + FastAPI + RAG) | `openpolvointeligence` | `python-intelligence-standards` |

Ao editar qualquer arquivo, siga o skill da stack correspondente (e o `AGENTS.md` daquela pasta). O contrato entre stacks é o **schema HTTP/JSON**.

## Trabalho multiagente (padrão deste repo)

Sempre que o pedido for **nova feature, melhoria de código/performance ou refactor** que toque mais de uma stack, use o skill `parallel-dev-orchestrator`:

1. **Spec** o objetivo e decomponha por stack.
2. **Explore em paralelo** (subagentes read-only + RAG) para contexto mínimo.
3. **Congele o contrato** de interface antes de implementar.
4. **Implemente em paralelo** — 1 subagente por stack, escopo e arquivos-alvo disjuntos, vinculado ao skill da stack.
5. **Verifique e integre** — portão build/lint/test por stack + checagem do contrato cruzado.

Regra de ouro: subagentes só rodam em paralelo se escreverem em **arquivos disjuntos**; senão, serialize.

## Portões de qualidade por stack

- Frontend: `tsc` + `vite build`.
- Backend: `gofmt`/`go vet ./...` + `go build ./...` + `go test ./...`.
- Intelligence: `ruff check` + `ruff format --check` + `pytest`.

## Princípios

- Código limpo, performático e tipado; **sem erros engolidos nem código morto/lixo**.
- Contexto mínimo via RAG/`SemanticSearch`, não o repo inteiro.
- Cada subagente tem responsabilidade única, skill de padrão e portão de verificação.
