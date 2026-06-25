# Migração `openpolvo` → `polvocode`

**Estado: cutover concluído.** O frontend React (`openpolvo/`) foi removido do monorepo.
O `polvocode` é o frontend oficial e consome `openpolvobackend` + `openpolvointeligence`.

## Camada de compatibilidade

- Protocolo partilhado: `src/vs/platform/agentHost/common/openpolvoBackendProtocol.ts`
  (rotas, mapeamento de modelo, construção de payload, parsing/normalização de SSE).
- Cliente Node (Agent Host): `src/vs/platform/agentHost/node/openpolvo/openPolvoApiClient.ts`.
- Serviço browser (polvoModes): `src/vs/workbench/contrib/polvoModes/browser/openPolvoWorkbenchApiService.ts`.

`createSession` mapeia para `POST /v1/conversations`; `streamMessage` para
`POST /v1/conversations/{id}/messages/stream`. Os eventos ricos (`progress`, `agent_event`,
`file`, `messages_saved`, `done`, `error`) são normalizados para o formato simples que as UIs
já consumiam (`thinking` | `text_delta` | `done` | `error`), com novos tipos `agent_event`,
`file` e `tool_call` para os fluxos avançados.

## Feature flags (migração faseada)

| Setting | Default | Efeito |
|---|---|---|
| `openpolvo.api.baseUrl` | `http://127.0.0.1:8081` | Backend oficial (Go). |
| `openpolvo.agent.enabled` | `true` | Agente OpenPolvo no Agent Host. |
| `openpolvo.workflows.useBackend` | `true` | Workflow NL via `/v1/workflows/generate` (senão chat livre). |
| `openpolvo.devWorkflow.enabled` | `true` | Aplica ficheiros gerados (`file`) no workspace local. |

Variáveis de ambiente equivalentes: `OPENPOLVO_API_BASE_URL`, `OPENPOLVO_API_TOKEN`, `OPENPOLVO_AGENT_ENABLED`.

## Matriz de paridade (go/no-go)

| Fluxo | Endpoint oficial | Estado |
|---|---|---|
| Login / auth | `POST /v1/auth/login`, `/register` | ✅ |
| Conversas + envio | `POST /v1/conversations`, `…/messages/stream` | ✅ |
| SSE rico (progress/file/agent_event) | stream | ✅ (normalizado) |
| Desk tools (filesystem/terminal/git) | `agent_event(tool_call)` + `…/desk-tool-result` | ✅ (Agent Host, Node) |
| Dev workflow (apply de ficheiros) | evento `file` | ✅ (flag `devWorkflow.enabled`) |
| Workflow por linguagem natural | `POST /v1/workflows/generate` | ✅ (flag `workflows.useBackend`) |
| LLM profiles | `GET/POST/DELETE /v1/llm/profiles` | ✅ (comando *OpenPolvo: Gerir perfis LLM*) |
| SMTP | `GET/PUT /v1/me/smtp`, `…/smtp/test` | ✅ (comando *OpenPolvo: Configurar SMTP*) |

Smoke de regressão: `scripts/polvocode-endpoints-test.ps1` (go/no-go automático).

## Cutover (concluído)

1. ~~Período de convivência~~ — `openpolvo/` removido.
2. Smoke `polvocode-endpoints-test.ps1` → login, agente, dev, workflow, SMTP validados.
3. Scripts de build do frontend antigo (`setup.ps1`, `release-desktop.yml`, `build-desktop-artifacts.ps1`) removidos.
4. Documentação raiz e `docs/` actualizados para `polvocode`.
