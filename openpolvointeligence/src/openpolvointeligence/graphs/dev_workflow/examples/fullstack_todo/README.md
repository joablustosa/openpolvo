# Fullstack Todo — golden fixture (estrutura esperada)

App de exemplo gerada com stack `fullstack-react-go`.

## Layout

```
{slug}/
├── Makefile
├── dev.ps1
├── README.md
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── pages/TodoPage.tsx      ← LLM
│       └── components/TodoList.tsx ← LLM
└── backend/
    ├── go.mod
    ├── cmd/api/main.go
    └── internal/app/todos/         ← LLM (hexagonal)
```

## Paths de produto (LLM)

- `frontend/src/pages/TodoPage.tsx`
- `frontend/src/components/TodoList.tsx`
- `backend/internal/app/todos/domain/todo.go`
- `backend/internal/app/todos/application/service.go`
- `backend/internal/transport/http/router.go` (modify — registar rotas)

## Comando dev

```bash
make dev   # Linux/macOS
./dev.ps1  # Windows
```
