"""Scaffold fullstack React (Vite) + Go hexagonal — layout frontend/ + backend/."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.go_api_scaffold import (
    get_go_hex_scaffold_files,
)
from openpolvointeligence.graphs.dev_workflow.vite_react_scaffold import (
    get_vite_react_scaffold_files,
)

_FULLSTACK_REACT_GO_STACKS = frozenset({"fullstack-react-go"})


def scaffold_supports_stack(stack: str | None) -> bool:
    return (stack or "") in _FULLSTACK_REACT_GO_STACKS


def _root_files(project_name: str) -> dict[str, str]:
    return {
        "README.md": f"""# {project_name}

Monorepo **React (Vite) + Go** gerado pelo Open Polvo Dev Studio.

## Desenvolvimento

```bash
# Linux/macOS
make dev

# Windows
./dev.ps1
```

- Frontend: http://127.0.0.1:5173 (proxy `/api` → backend)
- Backend: http://127.0.0.1:8080

## Estrutura

- `frontend/` — React + TypeScript + Tailwind v4 + shadcn
- `backend/` — Go 1.25 + chi (hexagonal)
""",
        "Makefile": """.PHONY: dev test lint

dev:
\t@echo "Arrancar backend e frontend..."
\t@(cd backend && go run ./cmd/api) & \\
\t cd frontend && npm run dev

test:
\tcd backend && go test ./...
\tcd frontend && npm run build

lint:
\tcd backend && go vet ./...
""",
        "dev.ps1": """# Windows — arranca backend e frontend
$backend = Start-Process -FilePath "go" -ArgumentList "run","./cmd/api" -WorkingDirectory "backend" -PassThru -WindowStyle Hidden
try {
  Set-Location frontend
  npm run dev
} finally {
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
}
""",
    }


def get_fullstack_react_go_scaffold_files(
    project_name: str,
    *,
    design_tokens: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Mapa path → conteúdo para monorepo frontend/ + backend/."""
    frontend = get_vite_react_scaffold_files(
        project_name,
        stack="vite-react",
        design_tokens=design_tokens,
        path_prefix="frontend/",
        api_proxy_port=8080,
    )
    backend = get_go_hex_scaffold_files(project_name, path_prefix="backend/")
    return {**frontend, **backend, **_root_files(project_name)}
