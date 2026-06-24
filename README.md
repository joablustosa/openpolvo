# Open Polvo Desk MVP v0.1.0

Agente de desenvolvimento **local** para desktop: chat com tools (ficheiros, terminal, git), shell **Agent / Code / Flow**, runtime **LangGraph** e provider **Ollama** por defeito.

> Este README descreve o **Desk MVP v0.1**. O monorepo inclui também o assistente Zé Polvinho (finanças, social, workflows) — oculto quando `VITE_DESK_MVP_MODE=true`.

## O que inclui v0.1

- **Agent Mode** — chat + painel de logs (`agent_event` SSE)
- **Code Mode** — Dev Studio enxuto no workspace local
- **Flow Mode** — placeholder «Em breve»
- **Tools locais** — filesystem, terminal (com confirmação), git status/diff
- **Memória** — histórico + bloco persistente por conversa (SQLite)
- **Desktop** — instalador Windows via Electron (Go + Python empacotados)

## Arranque rápido (dev)

Ver [docs/desk-mvp-quickstart.md](docs/desk-mvp-quickstart.md).

```powershell
# 1. Intelligence
cd openpolvointeligence; python -m uvicorn openpolvointeligence.api.app:app --port 8090

# 2. Backend
cd openpolvobackend; go run ./cmd/openlaele-api

# 3. Frontend (Desk mode)
cd openpolvo
# .env: VITE_DESK_MVP_MODE=true
npm run dev
```

## Contrato API

[docs/desk-api-contract.md](docs/desk-api-contract.md)

## Build instalador Desk

```powershell
# Da raiz do repo
powershell -File openpolvo/build-desktop-artifacts.ps1 -DeskMvpMode
cd openpolvo
npm run dist:win:desk
```

## Smoke test (release gate)

```powershell
powershell -File scripts/desk-mvp-smoke.ps1
powershell -File scripts/desk-mvp-smoke.ps1 -Live   # com stacks a correr
```

## Estrutura do monorepo

| Pasta | Stack |
|-------|--------|
| `openpolvo` | React 19 + Vite + Electron |
| `openpolvobackend` | Go — API, conversas, memória |
| `openpolvointeligence` | Python — `desk_graph` LangGraph |

## Release

- Tag: `desk-v0.1.0`
- Notas: [docs/releases/desk-v0.1.0.md](docs/releases/desk-v0.1.0.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Licença

Ver repositório upstream.
