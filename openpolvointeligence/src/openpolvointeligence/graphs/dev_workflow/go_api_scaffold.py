"""Scaffold Go API — mínimo e hexagonal para fullstack-react-go."""

from __future__ import annotations

import re

_GO_STACKS = frozenset({"go-api", "go"})
_HEX_STACKS = frozenset({"fullstack-react-go"})


def scaffold_supports_stack(stack: str | None) -> bool:
    return (stack or "") in _GO_STACKS


def hex_scaffold_supports_stack(stack: str | None) -> bool:
    return (stack or "") in _HEX_STACKS


def _slug_module(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "app"


def _prefix_paths(files: dict[str, str], prefix: str) -> dict[str, str]:
    if not prefix:
        return dict(files)
    norm = prefix.strip("/").replace("\\", "/")
    if norm:
        norm = norm + "/"
    return {f"{norm}{path}": content for path, content in files.items()}


def get_go_api_scaffold_files(project_name: str) -> dict[str, str]:
    module = _slug_module(project_name)
    return {
        "go.mod": f"module {module}\n\ngo 1.25\n",
        "main.go": """package main

import (
\t"fmt"
\t"log"
\t"net/http"
)

func main() {
\thttp.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
\t\tw.WriteHeader(http.StatusOK)
\t\t_, _ = w.Write([]byte("ok"))
\t})
\tfmt.Println("listening :8080")
\tlog.Fatal(http.ListenAndServe(":8080", nil))
}
""",
        "README.md": f"# {project_name}\n\nAPI Go mínima (healthz em `/healthz`).\n",
    }


def get_go_hex_scaffold_files(project_name: str, *, path_prefix: str = "") -> dict[str, str]:
    """Backend hexagonal (chi + CORS + feature items em memory)."""
    mod = _slug_module(project_name)
    items = f"{mod}/internal/app/items"
    transport = f"{mod}/internal/transport/http"

    files = {
        "go.mod": f"""module {mod}

go 1.25

require github.com/go-chi/chi/v5 v5.2.1
""",
        "cmd/api/main.go": f"""package main

import (
\t"log"
\t"net/http"
\t"os"

\thttptransport "{transport}"
)

func main() {{
\tport := os.Getenv("PORT")
\tif port == "" {{
\t\tport = "8080"
\t}}
\trouter := httptransport.NewRouter()
\tlog.Printf("API a correr em http://127.0.0.1:%s", port)
\tlog.Fatal(http.ListenAndServe(":"+port, router))
}}
""",
        "internal/transport/http/router.go": f"""package httptransport

import (
\t"net/http"

\titemhttp "{items}/adapters/http"
\t"{items}/adapters/memory"
\titemsapp "{items}/application"
\t"github.com/go-chi/chi/v5"
\t"github.com/go-chi/chi/v5/middleware"
)

func NewRouter() http.Handler {{
\tr := chi.NewRouter()
\tr.Use(middleware.Logger)
\tr.Use(middleware.Recoverer)
\tr.Use(corsMiddleware)

\trepo := memory.NewRepository()
\tsvc := itemsapp.NewService(repo)
\th := itemhttp.NewHandler(svc)

\tr.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {{
\t\tw.Header().Set("Content-Type", "application/json")
\t\t_, _ = w.Write([]byte(`{{"ok":true,"service":"{mod}"}}`))
\t}})
\tr.Route("/api/items", h.Routes)

\treturn r
}}
""",
        "internal/transport/http/middleware.go": """package httptransport

import "net/http"

func corsMiddleware(next http.Handler) http.Handler {
\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
\t\tw.Header().Set("Access-Control-Allow-Origin", "*")
\t\tw.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
\t\tw.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
\t\tif r.Method == http.MethodOptions {
\t\t\tw.WriteHeader(http.StatusNoContent)
\t\t\treturn
\t\t}
\t\tnext.ServeHTTP(w, r)
\t})
}
""",
        "internal/app/items/domain/item.go": """package domain

import "time"

type Item struct {
\tID        int64     `json:"id"`
\tTitle     string    `json:"title"`
\tDone      bool      `json:"done"`
\tCreatedAt time.Time `json:"createdAt"`
}
""",
        "internal/app/items/ports/repository.go": f"""package ports

import (
\t"context"

\t"{items}/domain"
)

type Repository interface {{
\tList(ctx context.Context) ([]domain.Item, error)
\tCreate(ctx context.Context, title string) (domain.Item, error)
}}
""",
        "internal/app/items/application/service.go": f"""package application

import (
\t"context"
\t"errors"
\t"strings"

\t"{items}/domain"
\t"{items}/ports"
)

var ErrInvalidInput = errors.New("items: título inválido")

type Service struct {{
\trepo ports.Repository
}}

func NewService(repo ports.Repository) *Service {{
\treturn &Service{{repo: repo}}
}}

func (s *Service) List(ctx context.Context) ([]domain.Item, error) {{
\treturn s.repo.List(ctx)
}}

func (s *Service) Create(ctx context.Context, title string) (domain.Item, error) {{
\ttitle = strings.TrimSpace(title)
\tif title == "" {{
\t\treturn domain.Item{{}}, ErrInvalidInput
\t}}
\treturn s.repo.Create(ctx, title)
}}
""",
        "internal/app/items/adapters/memory/repository.go": f"""package memory

import (
\t"context"
\t"sync"
\t"time"

\t"{items}/domain"
)

type Repository struct {{
\tmu    sync.RWMutex
\titems []domain.Item
\tnext  int64
}}

func NewRepository() *Repository {{
\treturn &Repository{{next: 1}}
}}

func (r *Repository) List(_ context.Context) ([]domain.Item, error) {{
\tr.mu.RLock()
\tdefer r.mu.RUnlock()
\tout := make([]domain.Item, len(r.items))
\tcopy(out, r.items)
\treturn out, nil
}}

func (r *Repository) Create(_ context.Context, title string) (domain.Item, error) {{
\tr.mu.Lock()
\tdefer r.mu.Unlock()
\titem := domain.Item{{
\t\tID:        r.next,
\t\tTitle:     title,
\t\tDone:      false,
\t\tCreatedAt: time.Now().UTC(),
\t}}
\tr.next++
\tr.items = append(r.items, item)
\treturn item, nil
}}
""",
        "internal/app/items/adapters/http/handler.go": f"""package httpadapter

import (
\t"encoding/json"
\t"errors"
\t"net/http"

\titemsapp "{items}/application"
\t"github.com/go-chi/chi/v5"
)

type Handler struct {{
\tsvc *itemsapp.Service
}}

func NewHandler(svc *itemsapp.Service) *Handler {{
\treturn &Handler{{svc: svc}}
}}

func (h *Handler) Routes(r chi.Router) {{
\tr.Get("/", h.list)
\tr.Post("/", h.create)
}}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {{
\trows, err := h.svc.List(r.Context())
\tif err != nil {{
\t\twriteError(w, http.StatusInternalServerError, err)
\t\treturn
\t}}
\twriteJSON(w, http.StatusOK, rows)
}}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {{
\tvar body struct {{
\t\tTitle string `json:"title"`
\t}}
\tif err := json.NewDecoder(r.Body).Decode(&body); err != nil {{
\t\twriteError(w, http.StatusBadRequest, err)
\t\treturn
\t}}
\trow, err := h.svc.Create(r.Context(), body.Title)
\tif err != nil {{
\t\tif errors.Is(err, itemsapp.ErrInvalidInput) {{
\t\t\twriteError(w, http.StatusBadRequest, err)
\t\t\treturn
\t\t}}
\t\twriteError(w, http.StatusInternalServerError, err)
\t\treturn
\t}}
\twriteJSON(w, http.StatusCreated, row)
}}

func writeJSON(w http.ResponseWriter, status int, v any) {{
\tw.Header().Set("Content-Type", "application/json")
\tw.WriteHeader(status)
\t_ = json.NewEncoder(w).Encode(v)
}}

func writeError(w http.ResponseWriter, status int, err error) {{
\twriteJSON(w, status, map[string]string{{"error": err.Error()}})
}}
""",
    }
    return _prefix_paths(files, path_prefix)
