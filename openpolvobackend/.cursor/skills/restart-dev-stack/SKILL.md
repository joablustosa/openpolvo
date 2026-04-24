---
name: restart-dev-stack
description: >-
  Restarts the Open Polvo Go API and the OpenLaEleFront Vite/Electron dev
  server after implementation work so only one API and one frontend instance
  run on the default ports. Use when finishing a feature or fix, when closing
  an implementation task, when the user mentions duplicate processes or wrong
  ports, or when dev servers should be refreshed after code changes.
---

# Reinício limpo da stack de desenvolvimento (API + front)

## Quando aplicar

- Ao **concluir** uma implementação que toque no backend (`cmd/openlaele-api`, `internal/…`) ou no front (`OpenLaEleFront`).
- Antes de considerar o trabalho **fechado**, se o utilizador costuma ter `go run` e `npm run dev` a correr.
- Sempre que fizer sentido **evitar várias instâncias** (porta da API conforme `HTTP_ADDR`, **5173**, **8090** Intelligence, ou processos órfãos).

## Portas típicas (este monorepo)

| Serviço | Porta | Notas |
|--------|------|--------|
| API Go | **`HTTP_ADDR`** em `openpolvobackend/.env` (ex. `:8080` ou `:8081`) | SQLite local (`DB_PATH`) |
| Intelligence (Python) | **8090** (ou `PORT` no `.env` do Python) | LangGraph |
| Vite / Electron | **5173** | `openpolvo`: `npm run dev` (desktop) ou `npm run dev:web` |

Preferir o script na raiz do monorepo: `scripts/restart-local.ps1` (lê `HTTP_ADDR` e `PORT` dos `.env`).

Se `VITE_API_BASE_URL` apontar para outro host/porta, alinha com `HTTP_ADDR`.

## Procedimento (executar na shell)

### 1. Parar o que estiver a escutar nas portas

**Windows (PowerShell, como administrador só se for necessário):**

```powershell
foreach ($port in 8080, 8081, 5173, 8090) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
```

**macOS / Linux:**

```bash
for port in 8080 8081 5173 8090; do
  pids=$(lsof -ti:$port 2>/dev/null) && kill $pids 2>/dev/null || true
done
```

Se ainda existirem processos antigos de `node`, `electron` ou `openlaele-api` ligados ao projecto, termina-os pelo gestor de tarefas ou `Get-Process` / `ps` antes de voltar a arrancar.

### 2. Arrancar de novo (uma instância de cada)

1. **Intelligence** — `openpolvointeligence` (venv + `python -m openpolvointeligence.main`).
2. **API** — `openpolvobackend`: `go run ./cmd/openlaele-api/` (`.env` na pasta do backend).
3. **Front desktop** — `openpolvo`: `npm run dev` (Vite + Electron).

   (`dev:web` = só Vite no browser.)

Usa **dois terminais** (ou jobs em background) para não misturar logs; o importante é **não** lançar segunda vez o mesmo comando sem antes libertar as portas.

### 3. Verificação rápida

- `GET http://127.0.0.1:<PORTA_DA_API>/health` → resposta `ok` (ou equivalente).
- Front em `http://127.0.0.1:5173` (ou a URL que o Vite imprimir).

## Checklist para o agente

Ao finalizar implementação com impacto em API ou UI:

- [ ] Libertar portas da **API** (`HTTP_ADDR`), **5173** e **8090** (ou valores nos `.env`).
- [ ] Arrancar **uma** API e **um** `npm run dev` no front.
- [ ] Confirmar que não há segundo `go run` nem segundo Vite sem necessidade.

## Notas

- Não adicionar ficheiros de documentação ao repositório só por causa desta skill; esta pasta `.cursor/skills/` é para o Cursor.
- Em CI ou builds de produção, este fluxo não substitui `go build` / `npm run build`.
