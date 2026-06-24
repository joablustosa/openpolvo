# Open Polvo Desk MVP — arranque local

Guia rápido para correr as **3 stacks** com Ollama como provider default.

## Pré-requisitos

- [Ollama](https://ollama.com/) instalado com um modelo (ex.: `ollama pull llama3.2`)
- Go 1.25+, Node 20+, Python 3.11+

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
# HTTP_ADDR=:8081 por defeito
```

## 3. Frontend / Desktop (Electron)

```powershell
cd openpolvo
cp .env.example .env
# VITE_DESK_MVP_MODE=true
npm install
npm run dev
```

Abrir `http://127.0.0.1:5174` (ou janela Electron). Com `VITE_DESK_MVP_MODE=true`, a landing é o **Desk shell** (Agent / Code / Flow).

## Verificação rápida

1. Escolher pasta de workspace no Desk.
2. No Agent Mode: «lista ficheiros src/» — deve usar tool filesystem.
3. «git status» — tool git via IPC.
4. Reiniciar app — conversa e memória persistem (M3).

## Build instalador Desk

```powershell
powershell -File openpolvo/build-desktop-artifacts.ps1 -DeskMvpMode
cd openpolvo
npm run dist:win:desk
```

## Smoke test (gate de release)

```powershell
powershell -File scripts/desk-mvp-smoke.ps1
powershell -File scripts/desk-mvp-smoke.ps1 -Live
```

## Contrato API

Ver [desk-api-contract.md](./desk-api-contract.md).

## Spec completa

Ver [linear-desk-mvp-setup.md](./linear-desk-mvp-setup.md).
