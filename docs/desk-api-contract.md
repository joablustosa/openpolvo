# Contrato HTTP — Open Polvo Desk MVP v0.1

Contrato mínimo entre **frontend** (`polvocode`), **backend Go** (`openpolvobackend`) e **intelligence** (`openpolvointeligence`).

## POST `/v1/conversations/{id}/messages/stream` (Go → cliente)

O cliente envia:

```json
{
  "text": "lista ficheiros src/",
  "model_provider": "ollama",
  "desk_context": {
    "mode": "agent",
    "workspace_path": "C:\\proj\\meu-repo",
    "conversation_id": "uuid-da-conversa",
    "model_provider": "ollama"
  }
}
```

Quando `desk_context` está presente, **não** se enviam contextos legados (finanças, meta, SMTP, Dev Studio, etc.).

### `desk_context`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `mode` | string | sim | `agent` ou `code` |
| `workspace_path` | string | não | Pasta do projecto no desktop |
| `conversation_id` | string | não | UUID estável da conversa |
| `model_provider` | string | não | Override do provider Desk |

## POST `/v1/reply/stream` (Go → Intelligence)

Body JSON alinhado com `ReplyRequest` (Pydantic) e `replyHTTPBody` (Go).

Campos Desk:

- `messages[]` — `{ role, content }` (histórico completo da conversa)
- `model_provider` — `ollama` por defeito no MVP
- `conversation_id` — UUID string
- `agent_memory` — `{ "global": "...", "builder": "..." }` (alias `workspace` → `builder`)
- `desk_context` — mapa com `mode`, `workspace_path`, `conversation_id`

Quando `desk_context.mode` ∈ `{agent, code}`, o Intelligence roteia para `desk_graph` (LangGraph ReAct).

## SSE — eventos para o cliente

| `type` | Descrição |
|--------|-----------|
| `progress` | Passo intermédio (`step`, `label`) |
| `delta` | Token/texto incremental (fluxo legado) |
| `agent_event` | Evento do agente Desk (`event_type`: `graph_step`, `tool_call`, `tool_result`, `thought`, `final`) |
| `file` | Ficheiro Dev Studio (ignorado no MVP Desk) |
| `messages_saved` | Histórico persistido após `done` |
| `done` | Fim do turno (`assistant_text`, `metadata`) |
| `error` | Falha (`detail`) |

### `agent_event` — tool_call (bridge desktop)

```json
{
  "type": "agent_event",
  "event_type": "tool_call",
  "payload": {
    "id": "call-uuid",
    "tool": "terminal_run",
    "name": "terminal_run",
    "args": { "command": "git status" },
    "requires_client": true
  }
}
```

O frontend Electron executa via IPC e submete o resultado:

`POST /v1/conversations/{id}/desk-tool-result` → Intelligence `POST /v1/desk/tool-result`

## Memória persistente

- Go carrega `agent_memory` do SQLite e envia no body.
- Intelligence injecta bloco formatado no system prompt (`load_context`).
- Metadata de resposta pode incluir `agent_memory_patch`; Go persiste via `ApplyAgentMemoryPatch`.

## Health

- `GET /healthz` — liveness
- `GET /readyz` — readiness (+ check Ollama quando configurado)
