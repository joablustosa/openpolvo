"""Execução de scripts e testes (sandbox / subprocess)."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_build_sandbox import run_build_sandbox


async def run_script(
    settings: Settings,
    project_files: dict[str, str],
    *,
    command: str | None = None,
) -> dict[str, Any]:
    """Corre build sandbox ou comando explícito."""
    if command:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "CI": "1"},
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=60.0)
        except asyncio.TimeoutError:
            proc.kill()
            return {"ok": False, "exit_code": 124, "output": "timeout"}
        text = (out or b"").decode("utf-8", errors="replace")
        return {"ok": proc.returncode == 0, "exit_code": proc.returncode or 0, "output": text}
    return await run_build_sandbox(settings, project_files)


async def run_tests(settings: Settings, project_files: dict[str, str]) -> dict[str, Any]:
    if "go.mod" in project_files:
        return await run_script(settings, project_files, command="go test ./...")
    if "package.json" in project_files:
        return await run_script(settings, project_files, command="npm test --if-present")
    if any(p.endswith("pyproject.toml") for p in project_files):
        return await run_script(settings, project_files, command="python -m pytest -q")
    return {"ok": True, "ran": False, "output": "no test runner detected"}
