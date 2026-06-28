# OpenPolvo — Guia para Agentes

Monorepo de um **agente de desenvolvimento** e de **automação/workflows com RAG**. Três stacks independentes que se comunicam por API HTTP/JSON.

## Integração com Octo Cluster (platform)

Abra o repo via `octo-cluster/octo-cluster.code-workspace` — multi-root: **octo-cluster** + **openpolvo** + **personal-vault**.

| Variável | Valor (platform) |
|----------|------------------|
| `AI_EXECUTION_CONTEXT` | `platform` |
| `OCTO_CLUSTER` | caminho do clone octo-cluster |

**Loop CORE** (um chat = um card):

```
/start-workspace  →  /scan OPE-123 descrição  →  /model  →  Execute plan  →  /ship  →  /close
```

| Fase | Comando / harness |
|------|-------------------|
| Bootstrap | `octo-cluster\install.ps1` (uma vez por máquina) |
| Discover | `invoke-pipeline.ps1 -Pipeline <phase> -Action discover` |
| Scan | `invoke-pipeline.ps1 -Pipeline scan -Action run` |
| Ship | `invoke-pipeline.ps1 -Pipeline ship -Action run` |
| Verify openpolvo | `repo-policies/openpolvo.yaml` → go build / go vet em openpolvobackend |

**Linear:** `/scan` **não cria** issue no contexto platform. Passe o ID no chat (`/scan OPE-158 …`); use o plugin Linear (MCP) para ler/atualizar issues. Criação de card = manual ou futuro provider platform.

**Token economy:** rules/skills em `octo-cluster/domains/core/` (caveman lite, @≤3, read-gate). Ver `octo-cluster/docs/ONBOARDING.md`.

**Secrets:** personal-vault local — nunca commitar; mapear para `.env` gitignored por stack.

## Stacks e padrões

| Stack | Pasta | Skill obrigatório |
|-------|-------|-------------------|
| Frontend (VS Code OSS + polvoModes) | `polvocode` | Padrões TypeScript do VS Code; ver `polvocode/OPENPOLVO.md` |
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

- Frontend (`polvocode`): `npm run transpile-client` (dev); ver `polvocode/OPENPOLVO.md`.
- Backend: `gofmt`/`go vet ./...` + `go build ./...` + `go test ./...`.
- Intelligence: `ruff check` + `ruff format --check` + `pytest`.

## Princípios

- Código limpo, performático e tipado; **sem erros engolidos nem código morto/lixo**.
- Contexto mínimo via RAG/SemanticSearch, não o repo inteiro.
- Cada subagente tem responsabilidade única, skill de padrão e portão de verificação.
