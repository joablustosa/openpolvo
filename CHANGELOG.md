# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed

- **Cada aba fala com o workflow certo** — mensagens da aba de desenvolvimento deixam
  de ser desviadas por palavras como "estudo", "relatório" ou "planilha" para os
  workflows de conversa/documentos: com contexto de projeto dev presente, todo o
  pedido vai para o agente de desenvolvimento (que responde dúvidas sem gerar código
  quando for o caso); anexos reais (xlsx/docx/pdf) continuam a activar os fluxos de
  documentos. No Agent mode, as ferramentas do agente (ficheiros, terminal, git) agora
  executam de imediato no serviço local em vez de esperar 60s por um cliente que não
  responde; e erros do workflow de desenvolvimento aparecem no chat da aba dev.

- **Criação de projeto no develop já não trava em "A carregar contexto do projecto…"** —
  o terminal sandbox do workflow de desenvolvimento deixou de bloquear o event loop do
  Intelligence (comandos correm em thread), o timeout mata a árvore inteira de processos
  no Windows (npx/npm órfãos penduravam o serviço para sempre), o contexto do projeto é
  lido directamente do disco (sem `find/cat`, que não existem no Windows) e `npx tsc`/
  `npx eslint` só correm com os pacotes já instalados (`--no-install`) — antes tentavam
  descarregar da rede a meio do workflow. Erros do workflow passam a aparecer no chat
  ("⚠️ O workflow de desenvolvimento falhou…") em vez de terminar em silêncio só com a
  pasta criada; chamadas LLM dos agentes têm timeout (`AGENT_LLM_TIMEOUT_S`).

### Added

- **Agente: edição cirúrgica de ficheiros** — o agente da aba Agent ganhou
  `filesystem_edit` (substitui um trecho único do ficheiro) e `filesystem_multi_edit`
  (várias edições atómicas — se uma falhar, nenhuma é aplicada), como no Claude Code.
  Alterações deixam de exigir reescrita total do ficheiro; erros orientam o modelo
  (trecho não encontrado / ambíguo). Funciona no serviço local e no cliente Electron.
- **Automações: nó HTTP + tentativas (retry) por passo** — novo nó "http" para chamar
  APIs (GET/POST/…, cabeçalhos e corpo, com substituição de `{{output:…}}` e proteção
  contra SSRF). Passos de rede (http, pesquisa web, e-mail) podem repetir automaticamente
  em caso de falha (campos `retries`/`retry_delay_ms` do nó).
- **Automações: executar agora + histórico de execuções no app** — o painel de Automações
  ganhou "Executar agora" (corre o workflow e mostra sucesso/falha) e "Ver execuções"
  (histórico com logs por passo). O botão de exemplo passou a criar o template
  determinístico "Pesquisa → E-mail" a partir do servidor. (Backend já existente; agora
  exposto no frontend.)
- **Resposta do agente em streaming token-a-token** — o agente Agent/Code Mode e o loop
  de desenvolvimento passam a enviar a resposta incrementalmente (evento `text_delta`),
  como no Claude/Cursor, com fallback automático para invocação normal quando o modelo/
  provider não suporta stream fiável (ex.: Ollama). Configurável por `DESK_STREAM_TOKENS`
  (agente) e `DEV_WORKFLOW_STREAM_TOKENS` (loop de dev).
- **Loop ReAct do agente — raciocínio visível e guarda de loop** — o agente Agent/Code Mode
  passa a emitir eventos `graph_step` e `thought` (o raciocínio entre chamadas de ferramenta
  fica visível em tempo real) e a cortar loops improdutivos (mesma ferramenta+argumentos
  repetida seguidamente).
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
