"""Virtual build determinístico — valida project_files antes do cliente."""

from __future__ import annotations

import re
from typing import Any

from openpolvointeligence.graphs.preview_source_sanitize import (
    preview_source_has_forbidden_imports,
)
from openpolvointeligence.graphs.shadcn_scaffold_exports import (
    validate_shadcn_named_imports,
)

_IMPORT_RE = re.compile(
    r"""import\s+(?:\{[^}]*\}|[\w\s,*]+)\s+from\s+['"]([^'"]+)['"]""",
    re.MULTILINE,
)

_FORBIDDEN_PACKAGES = (
    "@tanstack/react-query",
    "next/link",
    "next/navigation",
)

_ALLOWED_PACKAGES = (
    "react",
    "react-dom",
    "react-router-dom",
    "react-router",
    "lucide-react",
    "hono",
    "@hono/node-server",
    "@electric-sql/pglite",
    "drizzle-orm",
)

_DEFAULT_EXTENSIONS = (".tsx", ".ts", ".jsx", ".js")


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def _resolve_local_import(spec: str, project_files: dict[str, str]) -> bool:
    """True se o import local parece resolvível no projecto."""
    spec = spec.strip()
    keys = {_norm_path(k) for k in project_files}

    if spec.startswith("@/components/layout/") or spec.startswith("@/components/ui/"):
        return True
    if spec.startswith("@/lib/utils") or spec.startswith("@/lib/api"):
        return True

    if spec.startswith("@/"):
        rel = spec[2:]
        candidates = [
            f"src/{rel}",
            f"src/{rel}.tsx",
            f"src/{rel}.ts",
            f"src/{rel}/index.tsx",
        ]
        return any(c in keys for c in candidates)

    if spec.startswith("."):
        return True

    if spec.startswith(_ALLOWED_PACKAGES):
        return True

    if spec.startswith("server/") or spec.startswith("@/"):
        return True

    if "/" not in spec and not spec.startswith("."):
        return True

    return False


def _route_paths_from_app(app_content: str) -> list[str]:
    paths: list[str] = []
    for m in re.finditer(r'<Route\b[^>]*\bpath=["\']([^"\']+)["\']', app_content):
        paths.append(m.group(1))
    return paths


def run_static_verify(
    project_files: dict[str, str],
    *,
    pending_writes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Virtual build: merge pending writes + validações estáticas.
    Devolve {ok, errors[], error_digest[]}.
    """
    merged = dict(project_files or {})
    for w in pending_writes or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            merged[_norm_path(str(w["path"]))] = str(w.get("content") or "")

    errors: list[str] = []
    digest: list[dict[str, Any]] = []

    for path, content in merged.items():
        if not path.endswith((".tsx", ".jsx", ".ts", ".js")):
            continue
        body = str(content or "")

        if preview_source_has_forbidden_imports(body):
            msg = f"Import proibido em {path}"
            errors.append(msg)
            digest.append(
                {"path": path, "line": 1, "column": None, "code": "import", "message": msg},
            )

        for shadcn_err in validate_shadcn_named_imports(path, body):
            msg = str(shadcn_err.get("message") or "")
            errors.append(f"{msg} em {path}")
            digest.append(shadcn_err)

        for m in _IMPORT_RE.finditer(body):
            spec = m.group(1)
            if spec in _FORBIDDEN_PACKAGES:
                msg = f"Pacote proibido {spec} em {path}"
                errors.append(msg)
                digest.append(
                    {"path": path, "line": 1, "column": None, "code": "import", "message": msg},
                )
            elif spec.startswith("@/components/ui/"):
                continue
            elif spec.startswith("@/") or spec.startswith("."):
                if not _resolve_local_import(spec, merged):
                    msg = f"Import não resolvido '{spec}' em {path}"
                    errors.append(msg)
                    digest.append(
                        {
                            "path": path,
                            "line": 1,
                            "column": None,
                            "code": "module",
                            "message": msg,
                        },
                    )

    app_path = "src/App.tsx"
    app_content = merged.get(app_path, "")
    if app_content:
        page_imports = re.findall(
            r'import\s+(\w+)\s+from\s+["\']@/pages/(\w+)["\']',
            app_content,
        )
        for comp_name, page_name in page_imports:
            page_path = f"src/pages/{page_name}.tsx"
            alt_paths = [page_path, f"src/pages/{page_name}.jsx"]
            if not any(p in merged for p in alt_paths):
                msg = f"App.tsx importa {comp_name} mas {page_path} não existe"
                errors.append(msg)
                digest.append(
                    {
                        "path": app_path,
                        "line": 1,
                        "column": None,
                        "code": "missing",
                        "message": msg,
                    },
                )

        route_paths = _route_paths_from_app(app_content)
        pages = [
            _norm_path(p)
            for p in merged
            if _norm_path(p).startswith("src/pages/") and p.endswith((".tsx", ".jsx"))
        ]
        if pages and not route_paths and "Routes" not in app_content:
            msg = "App.tsx sem rotas mas existem páginas em src/pages/"
            errors.append(msg)
            digest.append(
                {
                    "path": app_path,
                    "line": 1,
                    "column": None,
                    "code": "routes",
                    "message": msg,
                },
            )

    ok = len(errors) == 0
    return {
        "ok": ok,
        "errors": errors[:20],
        "error_digest": digest[:15],
        "files_checked": len(merged),
    }
