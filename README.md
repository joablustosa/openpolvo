# Open Polvo

Agente de desenvolvimento **local** para desktop: chat com tools (ficheiros, terminal, git), modos **Agent / Code / Workflow**, runtime **LangGraph** e backend **Go + SQLite**.

## O que inclui

- **Agent Mode** — chat + eventos do agente (SSE)
- **Code Mode** — desenvolvimento no workspace local (Dev workflow)
- **Workflow Mode** — automações em linguagem natural
- **Tools locais** — filesystem, terminal, git (Agent Host no `polvocode`)
- **Memória** — histórico + bloco persistente por conversa (SQLite)
- **Desktop** — IDE `polvocode` (fork VS Code OSS + Electron)

## Arranque rápido (dev)

Ver [docs/desk-mvp-quickstart.md](docs/desk-mvp-quickstart.md).

```powershell
# 1. Intelligence
cd openpolvointeligence
uv run uvicorn openpolvointeligence.api.app:app --host 127.0.0.1 --port 8090

# 2. Backend
cd openpolvobackend
go run ./cmd/openlaele-api
# HTTP_ADDR=:8081

# 3. Frontend (polvocode)
cd polvocode
npm install
npm run transpile-client
# Ver polvocode/OPENPOLVO.md para lançar o Electron em dev
```

Login local (bootstrap): `admin@openlaele.local` / password em `openpolvobackend/.env` (`DEFAULT_ADMIN_PASSWORD`).

## Contrato API

[docs/desk-api-contract.md](docs/desk-api-contract.md)

## Estrutura do monorepo

| Pasta | Stack |
|-------|--------|
| `polvocode` | VS Code OSS + polvoModes (frontend oficial) |
| `openpolvobackend` | Go — API, conversas, memória |
| `openpolvointeligence` | Python — LangGraph, desk/dev workflows |

## Migração do frontend antigo

O frontend React (`openpolvo/`) foi removido. Detalhes em [polvocode/MIGRATION.md](polvocode/MIGRATION.md).

## Release histórico (Desk MVP v0.1)

- Tag: `desk-v0.1.0`
- Notas: [docs/releases/desk-v0.1.0.md](docs/releases/desk-v0.1.0.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Licença

Ver repositório upstream.
