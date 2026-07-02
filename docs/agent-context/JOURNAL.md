# JOURNAL — Diário de mudanças dos agentes

> Append-only. Uma entrada por melhoria/fix/integração/decisão. Mais recente no topo.
> Formato: `## AAAA-MM-DD — Título` + o quê / porquê / arquivos / follow-ups.

## 2026-07-01 — Roteamento por aba: dev/agent/workflow cada uma no workflow certo

**Sintoma:** mensagens da aba de desenvolvimento podiam ser "sequestradas" por
heurísticas de texto puro e cair em workflows errados; e o chat do Agent mode
pendurava 60s por tool_call (sem runner no cliente).

**Mapa das abas (verificado end-to-end):**
- **Dev (janela sessions)** → `openPolvoAgent.ts` envia `dev_studio_context.mode='code'`
  + `sandbox_project_id` (+ project_files) → Go passa integral (sem desk_context) →
  `/v1/reply/stream` → zepolvinho → fast-path dev workflow (gateway classifica
  explain/abort internamente).
- **Agent (polvoModes)** → `openPolvoWorkbenchApiService` envia `desk_context.mode='agent'`
  → Go faz `StripLegacyContextsForDesk` → desk graph (ReAct + tools); perguntas gerais
  de pesquisa/estudo continuam a ir para o conversation-rich (por design).
- **Workflow (automações)** → `/v1/workflows/generate` (workflow specialist);
  fallback de chat cai no desk.

**Bugs corrigidos:**
1. `routes.py` (`/reply` e `/reply/stream`): com contexto dev presente
   (`has_dev_studio_context`), os atalhos por texto (conversation-rich, pdf-study,
   criação xlsx/docx) deixam de desviar o pedido — só anexos reais mudam o fluxo.
   Ex.: "sistema de estoque com relatórios" caía no conversation-rich e nunca gerava
   o projeto; "exportação para planilha" caía no workflow de Excel.
2. `dev_workflow_routing.py`: novos `is_dev_studio_code_mode` + `has_dev_studio_context`;
   `should_use_dev_workflow` retorna True sempre que `mode='code'` (aba dev nunca
   depende de keywords). zepolvinho: plugins nativos e override pdf-study também
   respeitam o modo code.
3. **Agent mode sem runner de tools:** o chat polvoModes não trata eventos `tool_call`
   — cada tool do desk bloqueava 60s no bridge e falhava. Novo marcador
   `desk_context.tool_runner='server'` (front) + `desk_prefers_local_tools`
   (intelligence) → tools executam localmente no Intelligence (mesma máquina,
   sandbox/deny-patterns/gates de escrita mantidos).
4. `openPolvoAgent.ts` (aba dev): evento `workflow_error` agora aparece como
   "⚠️ Erro no workflow: …" no chat.

**Arquivos:** `api/routes.py`, `graphs/dev_workflow/core/dev_workflow_routing.py`,
`graphs/orchestrator/zepolvinho_graph.py`, `graphs/desk/desk_routing.py`,
`graphs/desk/desk_reply.py`; front: `openpolvoBackendProtocol.ts`,
`openPolvoWorkbenchApiService.ts`, `openPolvoAgent.ts`.

**Portão:** `pytest -m "not integration"` = 458 passed; smoke de roteamento via
TestClient com 7 cenários (dev/agent/sem-contexto/anexo) todos OK.

**Follow-ups:** considerar runner de tool_call no chat polvoModes (aprovação de
escritas na UI, como na janela sessions); testes API de roteamento permanentes.

## 2026-07-01 — Fix: criação de projeto no develop travava em "A carregar contexto do projecto…"

**Sintoma:** criar projeto no chat de develop (novo ou com repositório selecionado) só
criava a pasta e congelava em "A carregar contexto do projecto…"; erros do workflow
nunca chegavam ao chat.

**Causas (verificadas com repro):**
1. Terminal sandbox usava `subprocess.run` **síncrono dentro do event loop** — congelava
   todo o SSE/heartbeat do Intelligence (medido: 17,5s bloqueado só no context_loader).
2. `npx tsc`/`npx eslint` sem `node_modules` descarregam pacotes da rede (minutos) dentro
   desse bloqueio.
3. No Windows, timeout do `subprocess.run(shell=True)` mata só o `cmd.exe`; os filhos
   (node/npm) seguram os pipes e o `communicate()` pendura **para sempre** → travamento.
4. `context_loader` usava `find/cat/head` (inexistentes no Windows cmd).
5. Exceções dentro de `execution_graph.astream` eram engolidas em `run_execution`
   (task nunca awaited) → workflow "terminava" silencioso só com a pasta criada.

**Fixes (openpolvointeligence):**
- `desk/desk_tool_logic.py` — `_terminal_run_local` reescrito com `Popen` + kill de
  árvore de processos no timeout (`taskkill /F /T` no Windows, killpg no POSIX),
  `stdin=DEVNULL` (npx não fica à espera de input) e timeout configurável via
  `DEV_WORKFLOW_TERMINAL_TIMEOUT_S` (antes fixo em 60s — matava `npm install` a meio).
- `dev_workflow/tools/terminal_port.py` — `_run_local` via `asyncio.to_thread` (loop
  nunca bloqueia); idem `desk_tool_logic.dispatch_tool_calls` e `vcs/runner.py`.
- `dev_workflow/agents/context_loader.py` — contexto sandbox lido directamente do disco
  em Python (`_build_context_from_disk`, cross-platform, sem shell); enrichment git só
  com `.git` presente; tsc só com typescript em `node_modules` e com `npx --no-install`.
- NOVO `dev_workflow/tools/node_env.py` — `has_local_package` (guarda anti-download npx).
- `dev_workflow/tools/type_checker.py` + `agents/terminal_agents.py` (lint) — mesmos
  guards `--no-install`/node_modules em sandbox.
- `dev_workflow/core/dev_gateway_graph.py` — exceções do workflow agora emitem
  `workflow_error` (agent_event) e o `done` traz "⚠️ O workflow de desenvolvimento
  falhou…" + `metadata.error_kind=dev_workflow_execution_failed`; exec_task awaited.
- `dev_workflow/agents/base.py` — `invoke_json_agent` com timeout (`AGENT_LLM_TIMEOUT_S`,
  120s) — provider pendurado já não trava o workflow para sempre.

**Portão:** `pytest -m "not integration"` = 454 passed, 2 skipped (5 testes novos em
`tests/test_dev_workflow_terminal.py`: disco/kill-tree/guards). Smoke do stream new_app
com LLM off: contexto em ~0s, erro claro no chat, done em 8,8s (antes: travava).

**Follow-ups:** avaliar retry/fallback de provider nos agentes JSON (requirements/stack)
em vez de falhar o workflow; `npm install` do dependency agent respeita o timeout de
120s — projetos grandes dependem do post-setup do frontend (terminal real).

## 2026-07-02 — Agente Geral: edição cirúrgica de ficheiros (edit / multi-edit)

**O quê:** O agente Desk (aba Agent) ganhou `filesystem_edit` (substituição old→new com
old_text **único** no ficheiro, semântica Claude Code) e `filesystem_multi_edit`
(várias edições em ordem, **atómico**: se alguma falhar, nenhuma é aplicada). Antes só
havia `filesystem_write` (reescrita total) — o LLM tinha de reenviar o ficheiro inteiro.

**Implementação (dois lados do bridge):**
- Intelligence (`desk_tool_logic.py`): helper puro `apply_unique_edits` + `_edit_file_local`
  (sandbox `resolve_under_workspace`, guards de tamanho, erros acionáveis
  `old_text_not_found`/`old_text_ambiguous` com hint) + schemas + StructuredTools +
  cases em `execute_tool_local`. Prompt `desk_agent_system.md` orienta: edit p/ alterar,
  write só p/ criar/reescrever.
- Cliente Electron (`deskToolRunner.ts`): cases `filesystem_edit`/`filesystem_multi_edit`
  com a mesma semântica (único + atómico), para o caminho bridge.

**Mantido:** read/write/list e todas as outras tools intactas (aditivo).

**Portão:** ruff OK; `tests/test_desk_fs_edit.py` = 11 testes (lógica pura, disco,
atomicidade, traversal, registo). Suíte: 464 passed. ⚠️ **9 falhas pré-existentes** em
`test_models_provider_resolution.py`/`test_provider_anthropic.py` vindas do commit
`06f0be7b` da main (fix de quota mudou `resolve_chat_provider` sem atualizar os testes)
— não relacionadas; a corrigir em separado.

## 2026-07-01 — Automações P1 (parte 1): nó HTTP + retry por passo

**O quê (engine Go, `internal/workflows`):**
- **Nó HTTP (item 5):** novo tipo `http`/`http_request`. `NodeData` ganha `Method`,
  `Headers`, `Body`. URL/body/valores de headers passam por `expandEmailTemplates`
  (`{{previous}}`/`{{output:ID}}`). Guard SSRF `isSafePublicURL` (bloqueia loopback/privado/
  metadata). Resposta (texto truncado) guardada em `outputs[id]`. Status ≥400 = erro.
- **Retry por passo (item 11):** `NodeData.Retries`/`RetryDelayMs` + helper `withRetry`;
  aplicado aos nós de rede `http`, `web_search`, `send_email`. Browser já tem timeout.
- `doHTTPRequest` = guard + `httpRequest` (mecânica testável isolada do SSRF).

**Mantido:** todos os outros nós e o executor linear intactos (mudanças aditivas; só o
web_search/send_email ganharam o wrapper de retry, sem mudar semântica de sucesso).

**Arquivos:** NOVO `engine/http_node.go` + `engine/http_node_test.go` (10 testes);
`domain/graph.go` (campos); `engine/runner.go` (case http + wrappers de retry).

**Portão:** `gofmt`/`go vet`/`go build ./...` OK; `go test ./internal/workflows/...` verde.

**Falta P1 (parte 2):** condicional if/else (12) e aprovação humana (13) — arquiteturais:
- Condicional exige **label nas arestas** (`GraphEdge.Label` "true"/"false") + skip-propagation
  no executor (contrato do grafo muda → afeta canvas + geração NL). Cross-stack.
- Aprovação exige **pausar/retomar** a run (hoje síncrona) → persistência de estado + endpoint
  de retomada. Grande. Design a confirmar antes de implementar.

## 2026-07-01 — Automações P0: run-now + histórico/logs + templates no frontend

**O quê:** Expostas no frontend `polvoModes` capacidades que já existiam no backend.
- **api service** (`openPolvoWorkbenchApiService.ts`): `runWorkflow`, `getWorkflowRuns`,
  `getWorkflowTemplates`, `createWorkflowFromGraph` + DTOs (`IOpenPolvoWorkflowRun`,
  `StepLog`, `Template`) + rotas em `OfficialRoutes` (`workflowRuns`, `workflowsTemplates`).
- **nav view** (`polvoWorkflowNavView.ts`): menu do workflow ganha **"Executar agora"**
  (POST /run, notifica sucesso/falha) e **"Ver execuções"** (GET /runs → quick-pick de
  runs → passos com ok/erro/mensagem). Injetados `INotificationService`/`IQuickInputService`.
- **Template determinístico (item 8):** o botão de exemplo passou a criar via
  `getWorkflowTemplates` + `createWorkflowFromGraph` (grafo pronto do backend) em vez de NL.

**Mantido:** composer NL, canvas, scheduler — tudo intacto (mudanças aditivas).

**Escopo/limitação:** só frontend (backend já pronto); **não verificável por transpile**
(fork VS Code sem node_modules). Símbolos-chave confirmados por inspeção
(`loadFromBackend`, `IQuickPickItem`, notification `info/error`). `RunGraph` inicializa
Playwright sempre → run do template sem browser falha com mensagem clara se sem Chromium.

**Arquivos:** `platform/agentHost/common/openpolvoBackendProtocol.ts` (rotas),
`polvoModes/browser/openPolvoWorkbenchApiService.ts`, `polvoModes/browser/polvoWorkflowNavView.ts`.

**Follow-up:** próximo — nó HTTP (5) e retry por passo (11); depois condicional (12).

## 2026-07-01 — Streaming: front verificado (P1) + loop de dev (P2)

**P1 — Render do `delta` no frontend (verificado por inspeção, sem mudança):**
O normalizador `openpolvoBackendProtocol.ts` já mapeia `delta`→`text_delta` lendo
`evt.delta ?? evt.text ?? evt.token` (o meu `{"type":"delta","text":…}` é consumido),
e trata `agent_event` (`thought`→thinking, `tool_call` client). `_sawText` evita
duplicação com o `done`. **O streaming do desk funciona end-to-end sem tocar no front.**

**P2 — Streaming token-a-token no loop de dev (`engines/agent_loop`):**
- `ModelBridge.decide(messages, *, emit, thread_id)`: novo `_invoke` streama via `astream`,
  acumula `AIMessageChunk`, emite `("text_delta",{delta})` e converte num AIMessage limpo
  (preserva tool_calls). **Só em modo nativo** (JSON=ação, não prosa) e com fallback ainvoke.
- `loop.py`: passa `emit` ao `decide` **só no top-level** (`depth==0`) — subagentes não
  poluem a UI. Flag `DEV_WORKFLOW_STREAM_TOKENS`.
- `dev_gateway_graph.py::emit_tool`: caminho especial `text_delta` → evento SSE top-level
  (os restantes continuam `agent_event`).

**Escopo/risco:** o render usa o MESMO caminho do desk (normalizer + text_delta), logo
baixo risco; UI do dev agent não executável aqui. Ollama (modo JSON) não streama prosa
— comportamento inalterado.

**Arquivos:** `engines/agent_loop/model_bridge.py`, `engines/agent_loop/loop.py`,
`core/dev_gateway_graph.py`, `core/config.py`, NOVO `tests/test_agent_loop_streaming.py` (6).

**Portão:** ruff OK; `pytest -m "not integration"` = 447 passed, 2 skipped. Sem regressões.

## 2026-07-01 — Agente Geral: streaming token-a-token (`delta`) com fallback

**O quê:** O agente Desk (Agent/Code Mode) passa a **streamar a resposta token a token**
(evento SSE `delta`), padrão Claude/Cursor, em vez de esperar a resposta inteira (`ainvoke`).

**Como (robusto, provider-agnóstico):**
- Nó `agent`: `_invoke_model` usa `bound.astream(...)`, acumula os `AIMessageChunk`,
  emite cada pedaço como `delta` e converte o acumulado num `AIMessage` limpo (preserva
  tool_calls). **Fallback automático** para `ainvoke` quando o stream falha (ex.: Ollama
  instável) — sem duplicar texto (usa o parcial se já emitiu deltas). Flag `DESK_STREAM_TOKENS`.
- `thought` só sai no **fallback** (sem stream); com stream, o texto já flui como `delta`.
- Driver `desk_reply.py`: `emit("delta",…)` vira evento SSE top-level `{"type":"delta","text":…}`
  (os restantes continuam `agent_event`).

**Cross-stack (verificado):** o proxy Go (`conversation_handlers.go`) é **passthrough**
(`sendLine(line)` repassa todo `data:` verbatim) → o `delta` chega ao frontend sem
mudança no Go. Frontend (render do delta): não verificável aqui (sem node_modules).

**Escopo:** só o agente Geral (desk). O loop de dev (`engines/agent_loop`, `model_bridge`)
é caminho separado com preview próprio — deixado como follow-up, para não arriscar o que
funciona.

**Arquivos:** `graphs/desk/desk_graph.py`, `graphs/desk/desk_reply.py`, `core/config.py`,
`tests/test_desk_react_events.py` (reescrito: 9 testes, stream + fallback).

**Portão:** ruff OK; `pytest -m "not integration"` = 441 passed, 2 skipped. Sem regressões.

## 2026-07-01 — Agente Geral: loop ReAct — transparência (thought/graph_step) + guarda de loop

**Contexto:** O loop agentico ReAct com tool-calling **já existia e estava completo** no
agente Desk (`graphs/desk/desk_graph.py`): load_context → agent (bind_tools) → tools ↔
agent → finalize, com limite de iterações e streaming de tool_call/tool_result/final/done.
Só implementei os gaps para paridade Claude, reusando o `emit` existente.

**Adicionado (só o que faltava):**
- **Eventos `graph_step` e `thought`** emitidos pelo nó `agent` — o raciocínio intermédio
  (texto que acompanha as tool_calls) fica visível no SSE. `thought` só quando há tool_calls
  (senão o texto é a resposta final, já emitida como `final`). O driver `desk_reply.py`
  embrulha qualquer `emit(kind,payload)` em `agent_event`, então flui sem mudança no driver.
- **Guarda de loop improdutivo**: `tool_calls_signature` + `is_unproductive_loop` +
  `tool_signatures` no state; se a mesma tool+args se repete 3 rondas seguidas,
  `should_continue_tools` finaliza (evita loop preso a gastar tokens).

**Arquivos:** `graphs/desk/desk_graph.py`, `graphs/desk/desk_state.py`,
NOVO `tests/test_desk_react_events.py` (8 testes, sem LLM real).

**Portão:** ruff check+format OK; `pytest -m "not integration"` = 439 passed, 2 skipped.
Sem regressões (testes desk existentes verdes).

**Follow-up:** streaming token-a-token (`delta`) do texto do agente — não existe (usa
`ainvoke`); é mudança maior (astream_events) e ficou fora deste escopo.

## 2026-07-01 — Automações: template Pesquisa→E-mail 1 clique + polimento

**Contexto:** Descoberto que a automação já existe **end-to-end** (backend `internal/workflows`
com scheduler ligado por omissão + engine com nós schedule/web_search/send_email; API
`/v1/workflows` + `/generate` + `/run`; SMTP `/me/smtp` + comando `polvo.settings.smtp`;
frontend `polvoModes` com modo Automações + canvas + service). Foco: onboarding perfeito,
polimento e guia — sem reconstruir.

**Feito:**
- **Template determinístico "Pesquisa → E-mail"** (`internal/workflows/domain/templates.go`):
  `ResearchEmailGraph` (schedule cron diário → web_search com enriquecimento → send_email
  com `{{output:search-1}}`) + `AllTemplates()`. Deps mínimas (SERPAPI + SMTP; sem LLM).
- **Endpoint** `GET /v1/workflows/templates` (handler + rota) devolvendo os presets.
- **Polimento (bug real):** o nó `llm` do engine passou a expandir `{{previous}}`/`{{output:ID}}`
  no prompt (antes só `send_email` expandia) — habilita `web_search → llm(resumo) → email`.
- **Frontend:** botão "Exemplo: Pesquisa → E-mail" no estado vazio do painel Automações
  (preenche prompt polido + cria via fluxo NL existente) + CSS. ⚠️ Não verificado por
  transpile (sem node_modules neste ambiente).
- **Guia + auditoria:** `docs/agent-context/GUIA-AUTOMACOES.md`.

**Portão:** Go `gofmt`/`go vet`/`go build ./...` OK; `go test ./internal/workflows/...`
verde (novos: 5 testes de template + 1 de expansão llm). Intelligence email tests OK.
Frontend: pendente `npm run transpile-client`.

**Follow-ups:** verificar o front (transpile) e, se quiser, trocar o botão de exemplo para
usar o endpoint de template determinístico (create-from-graph) em vez do fluxo NL.

## 2026-07-01 — B1: Bug-fix team em 1 comando (detect→fix→verify)

**O quê:** Reforço do fluxo `debug` (bug_fix) para fechar o loop detectar→corrigir→
verificar de forma robusta, reusando o que já existia (runners, repair loop, sandbox),
sem alterar os outros workflows.

**Melhorias:**
- **Detect** — novo passo `triage` (1º do workflow debug), determinístico/zero-token:
  classifica categoria (`triage_bug_category`), extrai sinal de erro/stack trace,
  localiza ficheiros suspeitos (pedido × project_files) e consulta a memória de erros
  (`recall_similar_errors`). Produz `bugfix_report` (fase detect) para dar alvo ao fixer.
- **Verify reforçado** — delivery gate do `debug` passa a correr `build` **graceful**
  (só se houver script `build` no package.json; projetos sem build não são penalizados),
  além de tsc+tests. O loop verify→fix (delivery_gate + repair_patch, bounded) já existia.
- **Relatório** — `node_deliver` fecha o `bugfix_report` (detect→corrigir→verify) com
  ficheiros alterados, checks corridos, falhas e nº de tentativas de repair; injeta no
  deliverable/metadata e, se o texto for genérico, num resumo legível (🐛 Bug-fix …).

**Porquê:** Paridade Claude/Cursor (reproduce/localize antes de corrigir; verify real
antes de entregar; resumo claro). Determinístico primeiro; LLM inalterado no fix.

**Arquivos:**
- NOVO `agents/bugfix_triage.py` (+ registo `triage` em `agents/runners.py`).
- `workflows/debug_workflow.py` — `triage` como 1º step.
- `workflows/delivery_gates.py` — build graceful no gate do debug (`_has_build_script`).
- `workflows/shared_nodes.py` — `_finalize_bugfix_report` + injeção no `node_deliver`.
- `core/dev_workflow_state.py` — chaves `bug_category`, `bugfix_report`.
- `core/config.py` — `DEV_WORKFLOW_DEBUG_BUILD_CHECK`.
- NOVO `tests/test_bugfix_team.py` — 11 testes (triage/grafo/gate/relatório).

**Portão:** ruff check + format OK; `pytest -m "not integration"` = 432 passed, 2 skipped.

**Follow-ups:** próximos P0 — C2 (router multi-modelo). Depois P1: MCP client, LSP,
@-mentions, apply/diff, UI de aprovação (D2).

## 2026-07-01 — A1: GitHub via gh + git como tools do agente (com gate)

**O quê:** O agente ganhou git (`git_branch`, `git_checkout`, `git_pull`, `git_push`,
`git_add`, `git_clone`, `git_log`) e `github` (gh: PR/issues/checks/repo) no Agent/Code
Mode; `github` também no loop de dev. Política **default-deny** para gh (allowlist
resource+action), classificação read/write e **gate de aprovação**.

**Modelo de gate:**
- Leituras (pr list, git log…) → automáticas.
- Escritas (pr create, git push…) → `requires_approval=True` no payload do `tool_call`
  (o cliente aprova no fluxo bridge); no caminho local/headless só correm com
  `VCS_ALLOW_WRITE=1` (ou `DESK_GIT_ALLOW_COMMIT` p/ commit, retrocompat).
- Bloqueadas server-side (nunca executam): `git push --force`, `gh repo delete/archive`,
  `gh secret *`, `gh auth login/logout`, `gh api`, e qualquer gh fora da allowlist.
- Rejeita metacaracteres de shell no comando gh (defesa em profundidade; execução sem shell).

**Porquê:** Paridade com Claude/Cursor no fluxo de terminal/GitHub, mantendo segurança
(ações irreversíveis atrás de aprovação). Funciona com Ollama e com keys (independe do LLM).

**Arquivos:**
- NOVO `graphs/vcs/policy.py` (classificação/gate puros), `graphs/vcs/runner.py`
  (execução subprocess, `_run_command` como único ponto de I/O), `graphs/vcs/__init__.py`.
- `graphs/desk/desk_tool_logic.py` — schemas + StructuredTools + `classify_vcs` +
  branch VCS em `dispatch_tool_calls` (bloqueio/aprovação/bridge com flag).
- `graphs/dev_workflow/engines/agent_loop/schemas.py` + `tools.py` — tool `github`
  (READ_TOOLS, schema, executor via `port.run` com gate).
- `core/config.py` — `OP_GITHUB_TOOLS_ENABLED`, `VCS_ALLOW_WRITE`.
- NOVO `tests/test_vcs_tools.py` — 26 testes (policy/gate/runner/dispatch/loop, sem git/gh reais).

**Portão:** ruff check + format OK; `pytest -m "not integration"` = 421 passed, 2 skipped.

**Follow-ups:** UI de aprovação no `polvocode` (D2); PR review automatizado (A5);
próximos P0 — C2 (router multi-modelo), B1 (bug-fix team).

## 2026-07-01 — A2/A3: Web search & fetch como tools do agente

**O quê:** `web_search` e `web_fetch` agora são ferramentas que o agente de código pode
chamar, nas duas superfícies (Agent/Code Mode e loop de dev). Execução server-side
(reusa `web_research`), read-only, com guard SSRF; provider-agnóstico (funciona com
Ollama local e com keys — só `web_search` precisa de `SERPAPI_API_KEY`).

**Porquê:** Paridade com Claude/Cursor (@web) — o agente pode buscar docs/versões/erros
sem sair do fluxo. A capacidade já existia mas estava presa ao Zé Polvinho.

**Arquivos:**
- NOVO `graphs/web_research/web_tools.py` — executores partilhados (`run_web_search`,
  `run_web_fetch`, `run_web_tool`, `WEB_TOOL_NAMES`).
- `graphs/desk/desk_tool_logic.py` — 2 StructuredTools + branch server-side em
  `dispatch_tool_calls` (não passa pelo bridge); `desk_langchain_tools(settings)`.
- `graphs/desk/desk_graph.py` — passa `settings` ao construir tools.
- `graphs/dev_workflow/engines/agent_loop/schemas.py` — web tools em READ_TOOLS + 2 schemas.
- `graphs/dev_workflow/engines/agent_loop/tools.py` — handlers em `execute_agent_tool`.
- `core/config.py` — flags `OP_WEB_TOOLS_ENABLED`, `WEB_SEARCH_MAX_RESULTS`; `populate_by_name=True`.
- NOVO `tests/test_web_tools.py` — 14 testes (sem rede/LLM real).

**Portão:** ruff check + format OK; `pytest -m "not integration"` = 395 passed, 2 skipped.

**Nota de compat:** `populate_by_name=True` no Settings é aditivo (env/alias continuam
a funcionar); tornou os novos campos aliased construíveis por nome nos testes.

**Follow-ups:** próximos P0 — A1 (GitHub via gh), C2 (router multi-modelo), B1 (bug-fix team).
Frontend `polvocode`: render de @web/badges é item B2 (separado).

## 2026-07-01 — Bootstrap de contexto + suite de skills agenticos

**O quê:** Estudo profundo do monorepo e criação da base de contexto para agentes.
- Skills transversais em `.claude/skills/` (7): agentic-architecture, parallel-dev-orchestrator,
  agent-tool-design, agentic-workflow-design, agent-ux-streaming, context-memory-engineering,
  agent-eval-and-safety.
- Contexto: `CLAUDE.md` (raiz), `docs/agent-context/PROJECT-MAP.md`, `CAPABILITIES.md`,
  `PARITY-ROADMAP.md`, este `JOURNAL.md`.

**Porquê:** Estabelecer memória viva do projeto e o plano de paridade com Claude/Cursor
antes de implementar integrações (GitHub, web-search tool, MCP, router multi-modelo, bug-fix team).

**Arquivos:** `.claude/skills/**`, `CLAUDE.md`, `docs/agent-context/**`.

**Follow-ups:** Implementar Sprint 1 (P0) do `PARITY-ROADMAP.md` — a definir prioridade com o utilizador.
