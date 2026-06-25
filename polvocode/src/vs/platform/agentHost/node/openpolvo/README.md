# OpenPolvo Agent Host provider

Provider `openpolvoAh` (`agent-host-openpolvo`) conectado à API Go em `OPENPOLVO_API_BASE_URL`.

## Estado atual

- `OpenPolvoAgent` registrado em `agentHostMain.ts` e `agentHostServerMain.ts`
- Chat/Sessions usam `chat.editor.defaultProvider: openpolvoAh`
- UI `polvoModes` usa `OpenPolvoWorkbenchApiService` (HTTP direto) com login na IDE

## Configuração

| Setting / env | Descrição |
|---------------|-----------|
| `openpolvo.api.baseUrl` | URL da API (default `http://localhost:8080`) |
| `openpolvo.api.token` | JWT após login na IDE |
| `openpolvo.agent.enabled` | Habilita provider no Agent Host |
| `OPENPOLVO_API_BASE_URL` | Env passado ao Agent Host na inicialização |
| `OPENPOLVO_API_TOKEN` | Env do token no Agent Host |

## Login

Na IDE: clique **Agente** ou **Workflow** → tela de login OpenPolvo.

Comando manual: `openpolvo.signIn` (F1).
