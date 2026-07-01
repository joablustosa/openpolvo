"""ContextLoaderAgent — carrega project_context via terminal."""

from __future__ import annotations

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
from openpolvointeligence.graphs.dev_workflow.tools.filesystem import grep_in_memory, read_file
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

    gs = await port.git_status()
    if gs.ok and gs.stdout.strip():
        ctx["git_status"] = gs.output()[:2000]

    commits = await port.run("git log --oneline -10")
    if commits.ok and commits.stdout.strip():
        ctx["recent_commits"] = commits.stdout[:2000]

    has_pkg = bool(ctx.get("package_json")) or "package.json" in files
    if has_pkg:
        ts = await port.run("npx tsc --noEmit 2>&1")
        if ts.stdout or ts.stderr:
            ctx["ts_baseline"] = (ts.stdout or ts.stderr)[:3000]


async def load_project_context(
    settings: Settings,
    state: DevWorkflowState,
    port: DevTerminalPort | None = None,
) -> ProjectContext:
    """Protocolo do spec — find/cat/tsc/git com fallback in-memory."""
    files = dict(state.get("project_files") or {})
    p = port or get_terminal_port() or build_terminal_port(
        settings, dict(state), bridge_wait=None, emit=None
    )

    if _is_greenfield_new_app(state, files) or (files and p.mode == "bridge"):
        ctx = _build_context_from_memory(state, files)
        await _optional_terminal_enrichment(p, ctx, files)
        return ctx

    ctx: ProjectContext = {}

    tree = await p.run("find src -type f 2>/dev/null | sort | head -200")
    ctx["file_tree"] = tree.stdout or p.find_files("src", limit=200)

    pkg = await p.run("cat package.json 2>/dev/null")
    ctx["package_json"] = pkg.stdout or read_file(files, "package.json") or ""

    types_grep = p.grep(r"^(export |interface |type )", globs=["ts", "tsx"])
    if not types_grep:
        for path in sorted(files):
            if path.endswith((".types.ts", "types.ts", ".d.ts")):
                types_grep += f"\n### {path}\n{files[path][:500]}"
    ctx["types_summary"] = types_grep[:4000]

    schema = await p.run(
        "cat prisma/schema.prisma 2>/dev/null || cat src/db/schema.ts 2>/dev/null",
    )
    ctx["db_schema"] = (
        schema.stdout
        or read_file(files, "prisma/schema.prisma")
        or read_file(files, "src/db/schema.ts")
        or ""
    )

    env = await p.run("cat .env.example 2>/dev/null")
    ctx["env_example"] = env.stdout or read_file(files, ".env.example") or ""

    gs = await p.git_status()
    ctx["git_status"] = gs.output()[:2000]
    commits = await p.run("git log --oneline -10 2>/dev/null")
    ctx["recent_commits"] = commits.stdout[:2000]

    if ctx.get("package_json") or "package.json" in files:
        ts = await p.run("npx tsc --noEmit 2>&1 | head -50")
        ctx["ts_baseline"] = ts.stdout[:3000]
    else:
        ctx["ts_baseline"] = ""

    public = grep_in_memory(files, r"^export ", globs=["ts"], max_matches=40)
    ctx["public_api"] = public[:3000]
    ctx["stack_detected"] = _detect_stack(ctx.get("package_json") or "", files)
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
