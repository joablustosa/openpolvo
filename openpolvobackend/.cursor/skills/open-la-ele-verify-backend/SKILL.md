---
name: open-polvo-verify-backend
description: >-
  Após alterações ao backend Go Open Polvo, validar build, testes e healthchecks
  HTTP (/healthz, /readyz). Usar sempre que implementar ou alterar API, migrações
  ou arranque do servidor.
---

# Verificar backend Open Polvo após implementações

Depois de mudanças em Go, migrações, rotas ou configuração de arranque:

## 1. Compilação e testes

Na **raiz do monorepo** (`go.mod`):

```bash
go build ./...
go test ./...
```

## 2. Healthchecks (API a correr)

Com a API ligada (ex.: `go run ./cmd/openlaele-api/`), confirma o host e porta do **`HTTP_ADDR`** no `.env` da raiz (ex.: `:8081` → `http://127.0.0.1:8081`).

**Liveness** (processo responde, JSON):

```bash
curl -sSf "http://127.0.0.1:PORTA/healthz"
```

Resposta esperada inclui `"status":"ok"`, `"service":"open-polvo-api"` e `"version"`.

**Readiness** (ping à base de dados):

```bash
curl -sSf "http://127.0.0.1:PORTA/readyz"
```

- `200` + `"status":"ready"` + `"checks"."dependencies":"ok"` → pronto para tráfego.
- `503` + `"status":"not_ready"` → rever MySQL ou firewall.

Em **PowerShell** podes usar `Invoke-WebRequest -Uri ... -UseBasicParsing` e inspecionar `.StatusCode` e `.Content`.

## 3. Endpoints legados

- `GET /health` — texto `ok` (load balancers simples).
- `GET /ready` — texto `ok` ou erro (equivalente lógico ao fluxo do `readyz`).

## 4. O que não fazer

- Não commits com output de `/healthz` que inclua dados sensíveis (o endpoint atual não expõe segredos).
- Se a API não arrancar por erro de BD, o healthcheck **só funciona depois** da ligação MySQL estar corrigida.

## Relação com outras regras

- Segredos: `.cursor/rules/open-polvo-secrets.mdc`
- README: atualizar tabela de rotas se mudares contratos — `.cursor/skills/open-polvo-readme/SKILL.md`
