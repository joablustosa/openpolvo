"""ContextLoaderAgent — carrega project_context via terminal."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import (
    create_project_for_kind,
)
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import (
    DevWorkflowState,
    ProjectContext,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
    has_existing_app_in_state,
    resolve_effective_workspace_path,
    resolve_existing_project_root,
)
from openpolvointeligence.graphs.dev_workflow.tools.filesystem import grep_in_memory, read_file
from openpolvointeligence.graphs.dev_workflow.tools.node_env import has_local_package
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    DevTerminalPort,
    build_terminal_port,
    get_terminal_port,
)
from openpolvointeligence.graphs.dev_workflow.engines.context.engine import (
    build_hierarchical_context,
)
from openpolvointeligence.graphs.dev_workflow.engines.symbols.graph import (
    build_symbol_graph_from_state,
)


def _detect_stack(package_json: str, project_files: dict[str, str]) -> str:
    if "go.mod" in project_files:
        return "go"
    if any(p.endswith("pyproject.toml") for p in project_files):
        return "python"
    pj = package_json.lower()
    if "next" in pj:
        return "next"
    if "vite" in pj:
        return "vite"
    return "node"


def _has_workspace(state: DevWorkflowState) -> bool:
    return bool(str(state.get("workspace_path") or state.get("workspace_id") or "").strip())


def _is_greenfield_new_app(state: DevWorkflowState, files: dict[str, str]) -> bool:
    kind = str(state.get("request_kind") or "")
    if kind != "new_app":
        return False
    if has_existing_app_in_state(dict(state)):
        return False
    if not _has_workspace(state):
        return True
    if not files:
        return True
    if len(files) < 8 and "package.json" not in files and "frontend/package.json" not in files:
        return True
    return create_project_for_kind(kind, has_workspace=True)


def _build_context_from_memory(
    state: DevWorkflowState,
    files: dict[str, str],
) -> ProjectContext:
    """Contexto rápido sem bridge/terminal — ideal para new_app e project_files em memória."""
    ctx: ProjectContext = {}
    tree_lines = sorted(files.keys())[:200] if files else []
    ctx["file_tree"] = "\n".join(tree_lines)
    ctx["package_json"] = read_file(files, "package.json") or read_file(files, "frontend/package.json") or ""

    types_grep = grep_in_memory(files, r"^(export |interface |type )", globs=["ts", "tsx"])
    if not types_grep:
        for path in sorted(files):
            if path.endswith((".types.ts", "types.ts", ".d.ts")):
                types_grep += f"\n### {path}\n{files[path][:500]}"
    ctx["types_summary"] = types_grep[:4000]

    ctx["db_schema"] = (
        read_file(files, "prisma/schema.prisma")
        or read_file(files, "src/db/schema.ts")
        or ""
    )
    ctx["env_example"] = read_file(files, ".env.example") or ""
    ctx["git_status"] = f"?? {len(files)} files in-memory\n" if files else "?? greenfield project\n"
    ctx["recent_commits"] = ""
    ctx["ts_baseline"] = ""
    ctx["public_api"] = grep_in_memory(files, r"^export ", globs=["ts"], max_matches=40)[:3000]
    ctx["stack_detected"] = _detect_stack(ctx.get("package_json") or "", files)
    return ctx


async def _optional_terminal_enrichment(
    port: DevTerminalPort,
    ctx: ProjectContext,
    files: dict[str, str],
) -> None:
    """Enriquece com git/tsc apenas em modo sandbox e quando faz sentido (não bloqueia em bridge)."""
    if port.mode == "bridge":
        return
    if port.mode != "sandbox" or not port.workspace_path:
        return

    wp = Path(port.workspace_path)
    if (wp / ".git").exists():
        gs = await port.run("git status --short --branch")
        if gs.ok and gs.stdout.strip():
            ctx["git_status"] = gs.output()[:2000]

        commits = await port.run("git log --oneline -10")
        if commits.ok and commits.stdout.strip():
            ctx["recent_commits"] = commits.stdout[:2000]

    # tsc só com typescript já instalado no workspace — `npx tsc` sem node_modules
    # descarrega pacotes da rede e congela o workflow.
    has_pkg = bool(ctx.get("package_json")) or "package.json" in files
    if has_pkg and has_local_package(port.workspace_path, "typescript"):
        ts = await port.run("npx --no-install tsc --noEmit")
        if ts.stdout or ts.stderr:
            ctx["ts_baseline"] = (ts.stdout or ts.stderr)[:3000]


_SKIP_SCAN_DIRS = frozenset(
    {
        "node_modules",
        ".git",
        ".hg",
        "dist",
        "build",
        "out",
        "coverage",
        ".next",
        ".turbo",
        "__pycache__",
        ".venv",
        "venv",
    },
)


def _scan_workspace_tree(workspace_path: str, limit: int = 200) -> list[str]:
    """Lista ficheiros do workspace via Python — cross-platform, sem shell."""
    root = Path(workspace_path)
    found: list[str] = []
    try:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(
                d for d in dirnames if d not in _SKIP_SCAN_DIRS and not d.startswith(".")
            )
            for fn in sorted(filenames):
                rel = os.path.relpath(os.path.join(dirpath, fn), root).replace("\\", "/")
                found.append(rel)
                if len(found) >= limit:
                    return found
    except OSError:
        pass
    return found


def _read_workspace_file(workspace_path: str, rel: str, max_bytes: int = 200_000) -> str:
    target = Path(workspace_path) / rel
    try:
        if target.is_file() and target.stat().st_size <= max_bytes:
            return target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        pass
    return ""


def _build_context_from_disk(
    state: DevWorkflowState,
    files: dict[str, str],
    workspace_path: str,
) -> ProjectContext:
    """Contexto lido directamente do disco (sandbox) — substitui find/cat via shell,
    que não funcionam no Windows e bloqueavam o event loop."""
    ctx: ProjectContext = {}
    tree = _scan_workspace_tree(workspace_path, limit=200)
    ctx["file_tree"] = "\n".join(tree)
    ctx["package_json"] = (
        _read_workspace_file(workspace_path, "package.json")
        or _read_workspace_file(workspace_path, "frontend/package.json")
        or read_file(files, "package.json")
        or ""
    )

    types_grep = grep_in_memory(files, r"^(export |interface |type )", globs=["ts", "tsx"])
    if not types_grep:
        for rel in tree:
            if rel.endswith((".types.ts", "types.ts", ".d.ts")):
                body = _read_workspace_file(workspace_path, rel, max_bytes=50_000)
                if body:
                    types_grep += f"\n### {rel}\n{body[:500]}"
            if len(types_grep) >= 4000:
                break
    ctx["types_summary"] = types_grep[:4000]

    ctx["db_schema"] = (
        _read_workspace_file(workspace_path, "prisma/schema.prisma")
        or _read_workspace_file(workspace_path, "src/db/schema.ts")
        or read_file(files, "prisma/schema.prisma")
        or read_file(files, "src/db/schema.ts")
        or ""
    )
    ctx["env_example"] = (
        _read_workspace_file(workspace_path, ".env.example")
        or read_file(files, ".env.example")
        or ""
    )
    ctx["git_status"] = f"?? {len(tree)} files on disk\n" if tree else "?? empty workspace\n"
    ctx["recent_commits"] = ""
    ctx["ts_baseline"] = ""
    ctx["public_api"] = grep_in_memory(files, r"^export ", globs=["ts"], max_matches=40)[:3000]
    ctx["stack_detected"] = _detect_stack(
        ctx.get("package_json") or "",
        files or {rel: "" for rel in tree},
    )
    return ctx


async def load_project_context(
    settings: Settings,
    state: DevWorkflowState,
    port: DevTerminalPort | None = None,
) -> ProjectContext:
    """Protocolo do spec — contexto de disco/memória com enrichment git/tsc opcional."""
    files = dict(state.get("project_files") or {})
    p = port or get_terminal_port() or build_terminal_port(
        settings, dict(state), bridge_wait=None, emit=None
    )

    if _is_greenfield_new_app(state, files) or (files and p.mode == "bridge"):
        ctx = _build_context_from_memory(state, files)
        await _optional_terminal_enrichment(p, ctx, files)
        return ctx

    if p.mode == "sandbox" and p.workspace_path and Path(p.workspace_path).is_dir():
        kind = str(state.get("request_kind") or "")
        create = create_project_for_kind(kind, has_workspace=_has_workspace(state)) if kind else False
        disk_root = resolve_existing_project_root(dict(state), create_project=create)
        disk_path = p.workspace_path
        if disk_root and not create:
            disk_path = resolve_effective_workspace_path(dict(state), create_project=False)
        ctx = await asyncio.to_thread(_build_context_from_disk, state, files, disk_path)
        await _optional_terminal_enrichment(p, ctx, files)
        return ctx

    # Sem workspace local utilizável (memory / bridge sem files) — contexto em memória.
    mem_files = files or dict(p.project_files or {})
    ctx = _build_context_from_memory(state, mem_files)
    await _optional_terminal_enrichment(p, ctx, mem_files)
    return ctx


async def run_context_loader_agent(
    settings: Settings,
    state: DevWorkflowState,
) -> dict[str, Any]:
    port = get_terminal_port() or build_terminal_port(
        settings, dict(state), bridge_wait=None, emit=None
    )
    ctx = await load_project_context(settings, state, port)
    mode = port.mode
    hier = build_hierarchical_context(state, agent_key="context_loader")
    sg = build_symbol_graph_from_state(state)
    patch = {
        "project_context": ctx,
        "terminal_mode": mode,
        "project_digest": (state.get("project_digest") or "")[:500]
        or str(ctx.get("stack_detected") or ""),
        **hier,
        "symbol_graph": sg.to_dict(),
    }
    return step_patch(state, "context_loader", patch, agent="context_loader")
