"""Type checker — tsc via bridge ou build sandbox."""

from __future__ import annotations

import re
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_build_sandbox import run_build_sandbox
from openpolvointeligence.graphs.dev_workflow.tools.node_env import has_local_package
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import DevTerminalPort


def _parse_errors(output: str) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for line in output.splitlines()[:40]:
        m = re.match(r"([^(]+)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.*)", line.strip())
        if m:
            errors.append(
                {
                    "path": m.group(1).strip(),
                    "line": int(m.group(2)),
                    "column": int(m.group(3)),
                    "code": f"TS{m.group(4)}",
                    "message": m.group(5).strip(),
                },
            )
    return errors


async def run_type_check(
    settings: Settings,
    project_files: dict[str, str],
    *,
    port: DevTerminalPort | None = None,
) -> dict[str, Any]:
    if port and port.mode in ("bridge", "sandbox") and port.workspace_path:
        # Em sandbox, só corre tsc com typescript instalado no workspace — `npx tsc`
        # sem node_modules descarrega pacotes da rede e congela o workflow.
        use_terminal = port.mode == "bridge" or has_local_package(
            port.workspace_path, "typescript"
        )
        if use_terminal:
            cmd = (
                "npx --no-install tsc --noEmit"
                if port.mode == "sandbox"
                else "npx tsc --noEmit 2>&1"
            )
            result = await port.run(cmd)
            errors = _parse_errors(result.stdout)
            ok = result.ok and not errors and "error TS" not in result.stdout
            return {
                "ok": ok,
                "ran": True,
                "output": result.output()[:4000],
                "errors": errors,
                "mode": port.mode,
            }
    if "package.json" not in project_files and not any(
        p.endswith((".ts", ".tsx")) for p in project_files
    ):
        return {"ok": True, "ran": False, "errors": []}
    patched = settings.model_copy(update={"dev_workflow_build_sandbox_tool": "tsc"})
    result = await run_build_sandbox(patched, project_files)
    errors = _parse_errors(str(result.get("output") or result.get("stderr") or ""))
    ok = bool(result.get("ok")) and not errors
    return {**result, "ok": ok, "errors": errors, "mode": "sandbox"}
