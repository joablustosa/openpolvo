"""Migrations Prisma quando o schema muda."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import DevTerminalPort


def _schema_changed(state: dict[str, Any]) -> bool:
    for w in state.get("pending_writes") or []:
        if not isinstance(w, dict):
            continue
        path = str(w.get("path") or "").replace("\\", "/")
        if "prisma/schema.prisma" in path or path.endswith("schema.prisma"):
            return True
    files = state.get("project_files") or {}
    return "prisma/schema.prisma" in files


async def run_migration(
    settings: Settings,
    state: dict[str, Any],
    port: DevTerminalPort,
) -> dict[str, Any]:
    if not _schema_changed(state):
        return {"ok": True, "ran": False, "note": "no prisma schema change"}
    validate = await port.run("npx prisma validate")
    if not validate.ok:
        return {"ok": False, "ran": True, "step": "validate", "output": validate.output()[:2000]}
    migrate = await port.run("npx prisma migrate dev --name devagent_auto --skip-seed")
    if not migrate.ok:
        generate = await port.run("npx prisma generate")
        return {
            "ok": generate.ok,
            "ran": True,
            "step": "generate_fallback",
            "output": migrate.output()[:1500] + "\n" + generate.output()[:500],
        }
    return {"ok": True, "ran": True, "step": "migrate", "output": migrate.output()[:2000]}
