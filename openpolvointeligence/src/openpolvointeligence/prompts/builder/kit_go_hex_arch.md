# Kit arquitectónico: `fullstack_go_hexagonal`

Espelhado de `openpolvobackend/`. Usa **sempre** este padrão quando o utilizador pede Go ou um sistema "sério".

## File tree obrigatório

```
(root)/
├── README.md
├── go.mod
├── go.sum
├── cmd/
│   └── {name}-api/
│       └── main.go                       # DI + chi router + ListenAndServe
├── internal/
│   ├── {feature}/
│   │   ├── domain/
│   │   │   └── {aggregate}.go            # structs + invariantes
│   │   ├── ports/
│   │   │   └── repository.go             # interfaces
│   │   ├── application/
│   │   │   ├── errors.go
│   │   │   ├── create_{aggregate}.go
│   │   │   ├── get_{aggregate}.go
│   │   │   └── list_{aggregate}.go
│   │   └── adapters/
│   │       └── mysql/
│   │           ├── {aggregate}_repository.go
│   │           └── scan.go
│   ├── platform/
│   │   ├── config/config.go              # env vars
│   │   ├── db/db.go                      # sql.Open + ping
│   │   └── migrate/migrate.go            # golang-migrate
│   └── transport/
│       └── http/
│           ├── router.go                 # chi routes + middlewares
│           ├── errors.go                 # writeError/writeJSON
│           └── {feature}_handlers.go     # DTOs + handlers
├── migrations/
│   ├── 000001_init.up.sql
│   └── 000001_init.down.sql
└── web/
    └── (estrutura idêntica ao kit_frontend_arch — frontend React)
```

## `go.mod` mínimo

```
module github.com/user/app

go 1.22

require (
    github.com/go-chi/chi/v5 v5.1.0
    github.com/go-chi/cors v1.2.1
    github.com/go-sql-driver/mysql v1.8.1
    github.com/golang-migrate/migrate/v4 v4.18.1
    github.com/google/uuid v1.6.0
)
```

## Padrão `domain/{aggregate}.go`

```go
package domain

import (
    "time"
    "github.com/google/uuid"
)

type Task struct {
    ID        uuid.UUID
    Title     string
    Done      bool
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

## Padrão `ports/repository.go`

```go
package ports

import (
    "context"
    "github.com/google/uuid"
    "github.com/user/app/internal/tasks/domain"
)

type TaskRepository interface {
    Create(ctx context.Context, t *domain.Task) error
    GetByID(ctx context.Context, id uuid.UUID) (*domain.Task, error)
    List(ctx context.Context, limit int) ([]domain.Task, error)
    Update(ctx context.Context, t *domain.Task) error
    Delete(ctx context.Context, id uuid.UUID) error
}
```

## Padrão `application/create_task.go`

```go
package application

import (
    "context"
    "time"
    "github.com/google/uuid"
    "github.com/user/app/internal/tasks/domain"
    "github.com/user/app/internal/tasks/ports"
)

type CreateTask struct {
    Tasks ports.TaskRepository
}

func (uc *CreateTask) Execute(ctx context.Context, title string) (*domain.Task, error) {
    if title == "" {
        return nil, ErrTitleRequired
    }
    now := time.Now().UTC()
    t := &domain.Task{ID: uuid.New(), Title: title, CreatedAt: now, UpdatedAt: now}
    if err := uc.Tasks.Create(ctx, t); err != nil {
        return nil, err
    }
    return t, nil
}
```

## Padrão `adapters/mysql/{aggregate}_repository.go`

```go
package mysql

import (
    "context"
    "database/sql"
    "github.com/google/uuid"
    "github.com/user/app/internal/tasks/domain"
)

type TaskRepository struct {
    DB *sql.DB
}

func (r *TaskRepository) Create(ctx context.Context, t *domain.Task) error {
    _, err := r.DB.ExecContext(ctx,
        `INSERT INTO tasks (id, title, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        t.ID.String(), t.Title, t.Done, t.CreatedAt, t.UpdatedAt)
    return err
}
// GetByID, List, Update, Delete...
```

## Padrão `transport/http/router.go`

```go
package httptransport

import (
    "net/http"
    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/go-chi/cors"
)

type Deps struct {
    Tasks *TaskHandlers
}

func NewRouter(d Deps) http.Handler {
    r := chi.NewRouter()
    r.Use(middleware.RequestID, middleware.Recoverer)
    r.Use(cors.Handler(cors.Options{
        AllowedOrigins: []string{"*"},
        AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowedHeaders: []string{"Accept", "Content-Type"},
    }))
    r.Get("/health", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
    r.Route("/api/tasks", func(r chi.Router) {
        r.Get("/", d.Tasks.List)
        r.Post("/", d.Tasks.Create)
        r.Get("/{id}", d.Tasks.Get)
        r.Delete("/{id}", d.Tasks.Delete)
    })
    return r
}
```

## Migrations (golang-migrate)

Nomes sempre `NNNNNN_description.up.sql` / `.down.sql`, numeradas a partir de `000001`.

```sql
-- 000001_init.up.sql
CREATE TABLE tasks (
  id         CHAR(36)    NOT NULL,
  title      VARCHAR(512) NOT NULL,
  done       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Regras

- `UUID` sempre `github.com/google/uuid` — guardado como `CHAR(36)` em MySQL.
- Erros de domínio em `application/errors.go` (`var ErrTitleRequired = errors.New(...)`).
- DTOs HTTP em `transport/http/{feature}_handlers.go` (nunca expor `domain.*` directamente).
- `main.go` faz a composição: abre DB, cria repos, cria use cases, cria handlers, passa a `NewRouter(Deps{...})`, arranca `http.ListenAndServe`.
