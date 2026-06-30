"""Prefixo de paths para novas apps dentro de um workspace já aberto."""

from __future__ import annotations

import re
from typing import Any

_DEFAULT_ROOT = "openpolvo-app"


def slugify_project_title(title: str | None, *, fallback: str = _DEFAULT_ROOT) -> str:
    raw = (title or "").strip().lower()
    raw = re.sub(r"[^\w\s-]", "", raw, flags=re.UNICODE)
    raw = re.sub(r"[\s_-]+", "-", raw).strip("-")
    return (raw[:48] or fallback).strip("-") or fallback


def _norm_path(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def prefix_polvo_code_operations(
    operations: list[dict[str, Any]],
    project_root: str,
) -> list[dict[str, Any]]:
    """Prefixa paths relativos com a pasta do projecto (idempotente)."""
    root = _norm_path(project_root)
    if not root or not operations:
        return operations
    prefixed: list[dict[str, Any]] = []
    seen_mkdir: set[str] = set()
    root_mk = f"{root}"
    if root_mk not in seen_mkdir:
        prefixed.append({"op": "mkdir", "path": root_mk})
        seen_mkdir.add(root_mk)
    for row in operations:
        if not isinstance(row, dict):
            continue
        path = _norm_path(str(row.get("path") or ""))
        if not path:
            continue
        if path == root or path.startswith(f"{root}/"):
            prefixed.append(dict(row))
            continue
        item = dict(row)
        item["path"] = f"{root}/{path}"
        prefixed.append(item)
    return prefixed


def resolve_project_root_for_new_app(
    *,
    create_project: bool,
    has_workspace: bool,
    project_title: str | None,
    operations: list[dict[str, Any]] | None = None,
) -> str | None:
    """Devolve a pasta relativa do projecto quando é nova app num workspace existente."""
    if not create_project or not has_workspace:
        return None
    slug = slugify_project_title(project_title)
    ops = operations or []
    paths = [_norm_path(str(o.get("path") or "")) for o in ops if isinstance(o, dict)]
    paths = [p for p in paths if p]
    if paths and all(p.startswith(f"{slug}/") or p == slug for p in paths):
        return slug
    return slug
