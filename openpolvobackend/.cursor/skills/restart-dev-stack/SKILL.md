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
- Sempre que fizer sentido **evitar várias instâncias** (portas 8080, 5173 ou processos órfãos).

## Portas por defeito (este repositório)

| Serviço | Porta | Arranque típico |
|--------|------|------------------|
| API Go | **8080** | Raiz: `go run ./cmd/openlaele-api/` |
| Vite (dev) | **5173** | `OpenLaEleFront`: `npm run dev` |

Se `VITE_API_BASE_URL` ou outra variável apontar para outro host/porta, ajusta os comandos de libertação de porta em conformidade.

## Procedimento (executar na shell)

### 1. Parar o que estiver a escutar nas portas

**Windows (PowerShell, como administrador só se for necessário):**

```powershell
foreach ($port in 8080, 5173) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
```

**macOS / Linux:**

```bash
for port in 8080 5173; do
  pids=$(lsof -ti:$port 2>/dev/null) && kill $pids 2>/dev/null || true
done
```

Se ainda existirem processos antigos de `node`, `electron` ou `openlaele-api` ligados ao projecto, termina-os pelo gestor de tarefas ou `Get-Process` / `ps` antes de voltar a arrancar.

### 2. Arrancar de novo (uma instância de cada)

1. **API** — directório raiz do repositório (onde está `go.mod`), com `.env` carregado:

   ```bash
   go run ./cmd/openlaele-api/
   ```

2. **Front** — directório `OpenLaEleFront`:

   ```bash
   npm run dev
   ```

   (`dev` corre Vite e, após `wait-on`, o Electron; mantém um único fluxo definido em `package.json`.)

Usa **dois terminais** (ou jobs em background) para não misturar logs; o importante é **não** lançar segunda vez o mesmo comando sem antes libertar as portas.

### 3. Verificação rápida

- `GET http://127.0.0.1:8080/health` → resposta `ok` (ou equivalente).
- Front em `http://127.0.0.1:5173` (ou a URL que o Vite imprimir).

## Checklist para o agente

Ao finalizar implementação com impacto em API ou UI:

- [ ] Libertar portas **8080** e **5173** (ou portas configuradas no `.env`).
- [ ] Arrancar **uma** API e **um** `npm run dev` no front.
- [ ] Confirmar que não há segundo `go run` nem segundo Vite sem necessidade.

## Notas

- Não adicionar ficheiros de documentação ao repositório só por causa desta skill; esta pasta `.cursor/skills/` é para o Cursor.
- Em CI ou builds de produção, este fluxo não substitui `go build` / `npm run build`.
