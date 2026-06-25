# Open Polvo — arranque local

Guia rápido para correr as **3 stacks** com o frontend oficial `polvocode`.

## Pré-requisitos

- Go 1.25+, Node 20+, Python 3.11+
- [Ollama](https://ollama.com/) ou perfil LLM configurado (ex.: `ollama pull llama3.2`)
- Para Electron em dev: ver notas em [polvocode/OPENPOLVO.md](../polvocode/OPENPOLVO.md)

## 1. Intelligence (Python)

```powershell
cd openpolvointeligence
cp .env.example .env
# OLLAMA_BASE_URL=http://127.0.0.1:11434
uv sync
uv run uvicorn openpolvointeligence.api.app:app --host 127.0.0.1 --port 8090
```

## 2. Backend (Go)

```powershell
cd openpolvobackend
cp .env.example .env
go run ./cmd/openlaele-api
# HTTP_ADDR=:8081 por defeito no .env local
```

## 3. Frontend (`polvocode`)

```powershell
cd polvocode
npm install
npm run transpile-client
```

Defina `OPENPOLVO_API_BASE_URL=http://127.0.0.1:8081` e lance o Electron em dev (ver `polvocode/OPENPOLVO.md`).

No primeiro arranque, faça **Sign in to OpenPolvo** com o utilizador do bootstrap (`admin@openlaele.local` / `DEFAULT_ADMIN_PASSWORD` no `.env` do backend).

## Verificação rápida

1. Abrir pasta de workspace no `polvocode`.
2. Modo **Agente**: pedir «lista ficheiros» — deve usar tools locais.
3. Modo **Workflow**: gerar automação em linguagem natural.
4. Reiniciar IDE — conversa e memória persistem no SQLite do backend.

## Smoke test (gate de integração)

```powershell
powershell -File scripts/polvocode-endpoints-test.ps1
```

## Contrato API

Ver [desk-api-contract.md](./desk-api-contract.md).

## Spec histórica (Desk MVP v0.1)

Ver [linear-desk-mvp-setup.md](./linear-desk-mvp-setup.md) e [open-polvo-desk-mvp-prompt.md](./open-polvo-desk-mvp-prompt.md) — referem o frontend antigo; o fluxo actual usa `polvocode`.
