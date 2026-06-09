# openpolvobackend — Backend (Go 1.25, hexagonal)

Siga o skill `golang-backend-standards`.

## Invariantes

- Camadas por feature em `internal/<feature>/{domain,application,ports,adapters}` + `internal/transport/http`. Dependência só para dentro.
- `domain` puro (sem HTTP/SQL/infra). `application` depende de `ports` (interfaces), não de adapters. SQL só em `adapters`. Handlers só traduzem request↔caso de uso.
- Erros: sentinel por pacote em português, propagação com `%w`, mapeados a status HTTP. Nunca engolir erro nem `panic` em fluxo normal.
- `context.Context` é o 1º parâmetro e é propagado ao I/O. Queries sempre parametrizadas.

## Portão antes de concluir

`gofmt`/`goimports` + `go vet ./...` + `go build ./...` + `go test ./...` (use `-race` se houver concorrência).

## Contrato

Expõe a API HTTP consumida pelo `openpolvo` e fala com o `openpolvointeligence`. Mantenha shapes JSON estáveis e documentados.
