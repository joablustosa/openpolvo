"""Prefixo de paths para novas apps dentro de um workspace já aberto."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

_DEFAULT_ROOT = "openpolvo-app"
PROJECTS_PARENT_DIR = "projects"


def slugify_project_title(title: str | None, *, fallback: str = _DEFAULT_ROOT) -> str:
    raw = (title or "").strip().lower()
    raw = re.sub(r"[^\w\s-]", "", raw, flags=re.UNICODE)
    raw = re.sub(r"[\s_-]+", "-", raw).strip("-")
    return (raw[:48] or fallback).strip("-") or fallback


def _norm_path(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def build_project_root_path(slug: str) -> str:
    """Raiz relativa padrão: `projects/<slug>/` dentro do workspace."""
    rel = _norm_path(slug)
    if rel.startswith(f"{PROJECTS_PARENT_DIR}/"):
        parts = [p for p in rel.split("/") if p]
        if len(parts) >= 2:
            parts[-1] = slugify_project_title(parts[-1])
            return "/".join(parts)
    s = slugify_project_title(rel.split("/")[-1] if "/" in rel else rel)
    return f"{PROJECTS_PARENT_DIR}/{s}"


def _common_path_prefix(paths: list[str]) -> str:
    norm = [_norm_path(p) for p in paths if _norm_path(p)]
    if not norm:
        return ""
    parts_list = [p.split("/") for p in norm]
    common: list[str] = []
    for segs in zip(*parts_list, strict=False):
        if len(set(segs)) == 1:
            common.append(segs[0])
        else:
            break
    return "/".join(common)


def _looks_like_project_root(prefix: str) -> bool:
    p = _norm_path(prefix)
    if not p:
        return False
    if p.startswith(f"{PROJECTS_PARENT_DIR}/"):
        return True
    tail = p.split("/")[-1]
    return bool(tail) and tail not in {"src", "server", "public", "frontend", "backend"}


def _detect_projects_dir_on_disk(workspace_path: str | None) -> str | None:
    if not workspace_path:
        return None
    root = Path(workspace_path) / PROJECTS_PARENT_DIR
    if not root.is_dir():
        return None
    candidates: list[str] = []
    try:
        for child in sorted(root.iterdir()):
            if not child.is_dir() or child.name.startswith("."):
                continue
            rel = f"{PROJECTS_PARENT_DIR}/{child.name}"
            if (child / "package.json").is_file() or (child / "go.mod").is_file():
                candidates.append(rel)
    except OSError:
        return None
    if len(candidates) == 1:
        return candidates[0]
    return None


def resolve_existing_project_root(
    state: dict[str, Any],
    *,
    create_project: bool = False,
) -> str | None:
    """Raiz do projecto para feature/edit/debug — não inventa pasta nova."""
    explicit = _norm_path(str(state.get("polvo_code_project_root") or ""))
    if explicit:
        return explicit
    if create_project:
        return None
    files = state.get("project_files") or {}
    if isinstance(files, dict) and files:
        prefix = _common_path_prefix(list(files.keys()))
        if prefix and _looks_like_project_root(prefix):
            return prefix.rstrip("/")
    return _detect_projects_dir_on_disk(
        str(state.get("workspace_path") or state.get("workspace_id") or "").strip() or None
    )


def resolve_effective_workspace_path(state: dict[str, Any], *, create_project: bool = False) -> str:
    """Caminho absoluto onde correr terminal/git/npm (workspace ou subpasta do projecto)."""
    wp = str(state.get("workspace_path") or state.get("workspace_id") or "").strip()
    if not wp:
        return ""
    root = resolve_existing_project_root(state, create_project=create_project)
    if not root:
        root = _norm_path(str(state.get("polvo_code_project_root") or ""))
    if root:
        return str(Path(wp) / Path(root.replace("/", os.sep)))
    return wp


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
    for mk in _mkdir_chain_for_root(root):
        if mk not in seen_mkdir:
            prefixed.append({"op": "mkdir", "path": mk})
            seen_mkdir.add(mk)
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


def _mkdir_chain_for_root(project_root: str) -> list[str]:
    """Garante `projects/` e `projects/<slug>/` antes dos ficheiros."""
    root = _norm_path(project_root)
    if not root:
        return []
    parts = root.split("/")
    chain: list[str] = []
    for i in range(1, len(parts) + 1):
        chain.append("/".join(parts[:i]))
    return chain


def resolve_project_root_for_new_app(
    *,
    create_project: bool,
    has_workspace: bool,
    project_title: str | None,
    operations: list[dict[str, Any]] | None = None,
) -> str | None:
    """Devolve `projects/<slug>` quando é nova app num workspace existente."""
    if not create_project or not has_workspace:
        return None
    slug = slugify_project_title(project_title)
    ops = operations or []
    paths = [_norm_path(str(o.get("path") or "")) for o in ops if isinstance(o, dict)]
    paths = [p for p in paths if p]
    expected = build_project_root_path(slug)
    if paths and all(p.startswith(f"{expected}/") or p == expected for p in paths):
        return expected
    # Se o LLM já prefixou com projects/, respeitar
    if paths and all(p.startswith(f"{PROJECTS_PARENT_DIR}/") for p in paths):
        first = paths[0].split("/")
        if len(first) >= 2:
            return f"{first[0]}/{first[1]}"
    return expected


def strip_project_root_prefix(path: str, project_root: str) -> str:
    """Remove prefixo do projecto para project_files in-memory."""
    p = _norm_path(path)
    root = _norm_path(project_root)
    if not root:
        return p
    if p == root:
        return ""
    if p.startswith(f"{root}/"):
        return p[len(root) + 1 :]
    return p
