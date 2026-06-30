"""Injecta scaffold determinístico em operações de disco para `new_app`."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.fullstack_react_go_scaffold import (
    get_fullstack_react_go_scaffold_files,
    scaffold_supports_stack as fullstack_go_scaffold_supports_stack,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import slugify_project_title
from openpolvointeligence.graphs.dev_workflow.go_api_scaffold import (
    get_go_api_scaffold_files,
    scaffold_supports_stack as go_scaffold_supports_stack,
)
from openpolvointeligence.graphs.dev_workflow.vite_react_scaffold import (
    build_app_tsx_from_pages,
    get_vite_react_scaffold_files,
    scaffold_supports_stack,
)


def _norm_path(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def _op_paths(ops: list[dict[str, Any]]) -> set[str]:
    return {_norm_path(str(o.get("path") or "")) for o in ops if o.get("path")}


def _mkdirs_for_paths(paths: list[str]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    mkdirs: list[dict[str, Any]] = []
    for raw in paths:
        parts = _norm_path(raw).split("/")
        for i in range(1, len(parts)):
            folder = "/".join(parts[:i])
            if folder and folder not in seen:
                seen.add(folder)
                mkdirs.append({"op": "mkdir", "path": folder})
    return mkdirs


def _page_paths_from_llm(llm_paths: set[str]) -> list[str]:
    candidates = sorted(
        p
        for p in llm_paths
        if (p.startswith("src/pages/") or p.startswith("frontend/src/pages/")) and p.endswith(".tsx")
    )
    return candidates


def merge_scaffold_operations(
    llm_ops: list[dict[str, Any]],
    *,
    create_project: bool,
    stack: str | None,
    project_title: str | None,
    design_tokens: dict[str, Any] | None = None,
    existing_paths: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Prepende ficheiros de scaffold que o LLM não emitiu (projectos novos)."""
    if not create_project:
        return list(llm_ops)

    llm_paths = _op_paths(llm_ops)
    skip = set(existing_paths or set()) | llm_paths
    stack_norm = stack or "fullstack-react-go"
    project_name = slugify_project_title(project_title)

    if fullstack_go_scaffold_supports_stack(stack_norm):
        if "frontend/package.json" in skip:
            return list(llm_ops)
        files = get_fullstack_react_go_scaffold_files(project_name, design_tokens=design_tokens)
        page_paths = _page_paths_from_llm(llm_paths)
        if page_paths:
            show_sidebar = (design_tokens or {}).get("layout_shell") == "dashboard"
            app_key = (
                "frontend/src/App.tsx"
                if page_paths[0].startswith("frontend/")
                else "src/App.tsx"
            )
            files[app_key] = build_app_tsx_from_pages(page_paths, show_sidebar=show_sidebar)
    elif go_scaffold_supports_stack(stack_norm):
        if "go.mod" in skip:
            return list(llm_ops)
        files = get_go_api_scaffold_files(project_name)
    elif scaffold_supports_stack(stack):
        if "package.json" in skip or "frontend/package.json" in skip:
            return list(llm_ops)
        files = get_vite_react_scaffold_files(
            project_name,
            stack=stack_norm,
            design_tokens=design_tokens,
        )
        page_paths = _page_paths_from_llm(llm_paths)
        if page_paths:
            show_sidebar = (design_tokens or {}).get("layout_shell") == "dashboard"
            app_key = (
                "frontend/src/App.tsx"
                if page_paths[0].startswith("frontend/")
                else "src/App.tsx"
            )
            files[app_key] = build_app_tsx_from_pages(page_paths, show_sidebar=show_sidebar)
    else:
        return list(llm_ops)

    scaffold_ops: list[dict[str, Any]] = []
    for path, content in sorted(files.items()):
        if path in skip:
            continue
        scaffold_ops.append({"op": "write", "path": path, "content": content})

    merged = scaffold_ops + list(llm_ops)
    write_paths = [_norm_path(str(o.get("path") or "")) for o in merged if o.get("path")]
    mkdirs = _mkdirs_for_paths(write_paths)
    seen_mk: set[str] = set()
    out: list[dict[str, Any]] = []
    for op in mkdirs:
        p = _norm_path(str(op.get("path") or ""))
        if p and p not in seen_mk:
            seen_mk.add(p)
            out.append(op)
    for op in merged:
        if op.get("op") == "mkdir":
            continue
        out.append(op)
    return out


def infer_dev_setup_command(stack: str | None, ops: list[dict[str, Any]]) -> str | None:
    """Comando para arrancar a app localmente após criar/alterar o projecto."""
    paths = _op_paths(ops)
    if stack == "fullstack-react-go" or "Makefile" in paths:
        return "make dev"
    if "frontend/package.json" in paths and "backend/go.mod" in paths:
        return "make dev"
    if "backend/go.mod" in paths and "frontend/package.json" in paths:
        return "make dev"
    if "go.mod" in paths and "package.json" not in paths and "frontend/package.json" not in paths:
        return "go run ./cmd/api" if "cmd/api/main.go" in paths else "go run ."
    if "frontend/package.json" in paths:
        return "cd frontend && npm run dev"
    if "package.json" in paths or any(p.endswith("package.json") for p in paths):
        return "npm run dev"
    if stack in ("go-api",):
        return "go run ."
    if stack in ("node-api", "fullstack-mixed", "vite-react", "fullstack-react-go"):
        return "npm run dev"
    return None
