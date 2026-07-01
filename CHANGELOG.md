# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Automações: template "Pesquisa → E-mail" em 1 clique** — preset pronto (pesquisa web
  com enriquecimento → e-mail, agendado diariamente) criável pelo botão de exemplo no
  painel Automações e via `GET /v1/workflows/templates`. Configuração de SMTP pelo comando
  "OpenPolvo: Configurar SMTP". Guia em `docs/agent-context/GUIA-AUTOMACOES.md`.
- **Bug-fix team em 1 comando** — o fluxo de correção de bugs (`debug`) passa a fechar
  o ciclo detectar→corrigir→verificar: triagem determinística (categoria, sinal de erro,
  ficheiros suspeitos, memória de erros), verificação reforçada com build (quando há
  script, sem penalizar projetos sem build), loop de auto-reparação e **relatório
  estruturado** do que foi detectado, corrigido e verificado. Flag
  `DEV_WORKFLOW_DEBUG_BUILD_CHECK`.
- **Git & GitHub (gh) como tools do agente** — git (`branch`, `checkout`, `pull`,
  `push`, `add`, `clone`, `log`) e `github` (gh: PRs, issues, checks, repos) no
  Agent/Code Mode; `github` também no loop de dev. Política default-deny com gate de
  aprovação: leituras automáticas, escritas requerem aprovação (`requires_approval`),
  ações destrutivas (`push --force`, `repo delete`, `secret`, `auth login/logout`,
  `gh api`) bloqueadas. Flags `OP_GITHUB_TOOLS_ENABLED` e `VCS_ALLOW_WRITE`.
- **Web tools no agente** — `web_search` (SerpAPI) e `web_fetch` (trafilatura) expostas
  como ferramentas ao agente de código no Agent/Code Mode e no loop de dev. Execução
  server-side e read-only, com guard SSRF. Funcionam com Ollama local ou com keys de
  provider (`web_search` requer `SERPAPI_API_KEY`). Flags `OP_WEB_TOOLS_ENABLED` e
  `WEB_SEARCH_MAX_RESULTS`.

### Removed

- Frontend React (`openpolvo/`) — substituído por `polvocode` (VS Code OSS + polvoModes).
- `setup.ps1` e workflow CI `release-desktop.yml` (build do Electron antigo).

### Changed

- Documentação de arranque e contrato API actualizada para `polvocode`.
- **Nó `llm` dos workflows** passa a expandir `{{previous}}` / `{{output:ID}}` no prompt
  (antes só `send_email`), permitindo encadear pesquisa → resumo por LLM → e-mail.

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
