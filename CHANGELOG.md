# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Removed

- Frontend React (`openpolvo/`) — substituído por `polvocode` (VS Code OSS + polvoModes).
- `setup.ps1` e workflow CI `release-desktop.yml` (build do Electron antigo).

### Changed

- Documentação de arranque e contrato API actualizada para `polvocode`.

## [desk-v0.1.0] — 2026-06-24

### Added

- **Open Polvo Desk shell** — modos Agent, Code e Flow (stub) com `DeskShell` e toolbar de workspace/modelo.
- **Agente Desk LangGraph** (`desk_graph`) — ReAct com tools locais filesystem, terminal e git.
- **Bridge desktop** — SSE `tool_call` → IPC Electron → resultado via `/desk-tool-result`.
- **Provider Ollama** — default local; cloud providers atrás de `DESK_ALLOW_CLOUD_PROVIDERS`.
- **Memória MVP** — histórico trim (últimas 20 msgs), bloco persistente no prompt, patch SQLite.
- **Contrato HTTP** — `desk_context` alinhado entre frontend, Go e Python; docs em `docs/desk-api-contract.md`.
- **Flag `VITE_DESK_MVP_MODE`** — oculta rotas legacy e simplifica sidebar.
- **Smoke release** — `scripts/desk-mvp-smoke.ps1` + testes pytest `test_desk_smoke_release.py`.
- **Build desktop Desk** — `build-desktop-artifacts.ps1 -DeskMvpMode` + `npm run dist:win:desk`.

### Changed

- Stream de conversa passa a rotear para `desk_graph` quando `desk_context.mode` ∈ `{agent, code}`.
- Payloads legados Zé Polvinho omitidos no fluxo Desk (SMTP, finanças, Dev Studio, etc.).

### Security

- Path traversal bloqueado nas tools filesystem.
- Terminal com denylist e timeout; confirmação no cliente para comandos.

[desk-v0.1.0]: https://github.com/open-polvo/opel-la-ele/releases/tag/desk-v0.1.0
