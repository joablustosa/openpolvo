"""Git via bridge desktop ou memória."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import DevTerminalPort


async def git_status_summary(
    port: DevTerminalPort,
    project_files: dict[str, str],
) -> dict[str, Any]:
    result = await port.git_status()
    return {
        "ok": result.ok,
        "output": result.output()[:4000],
        "tracked_files": len(project_files),
    }


async def git_diff_summary(
    port: DevTerminalPort,
    _project_files: dict[str, str],
    path: str | None = None,
) -> dict[str, Any]:
    result = await port.git_diff(path or "")
    return {"ok": result.ok, "path": path, "output": result.output()[:4000]}


async def git_commit(
    port: DevTerminalPort,
    message: str,
    *,
    agent: str = "",
    workflow: str = "",
    session: str = "",
) -> dict[str, Any]:
    body = message.strip()
    if agent or workflow:
        body = f"{body}\n\nAgent: {agent}\nWorkflow: {workflow}\nSession: {session}".strip()
    result = await port.git_commit(body)
    return {
        "ok": result.ok,
        "output": result.output()[:2000],
        "committed": result.ok and "skipped" not in result.output().lower(),
    }
