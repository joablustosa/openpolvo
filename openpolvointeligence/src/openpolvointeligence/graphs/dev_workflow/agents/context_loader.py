"""ContextLoaderAgent — carrega project_context via terminal."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
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


async def load_project_context(
    settings: Settings,
    state: DevWorkflowState,
    port: DevTerminalPort | None = None,
) -> ProjectContext:
    """Protocolo do spec — find/cat/tsc/git com fallback in-memory."""
    p = (
        port
        or get_terminal_port()
        or build_terminal_port(settings, dict(state), bridge_wait=None, emit=None)
    )
    files = dict(state.get("project_files") or {})
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

    ts = await p.run("npx tsc --noEmit 2>&1 | head -50")
    ctx["ts_baseline"] = ts.stdout[:3000]

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
