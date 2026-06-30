"""Instalação de dependências identificadas pelo plano."""

from __future__ import annotations

import json
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    DevTerminalPort,
    TerminalResult,
)


def _packages_from_state(state: dict[str, Any]) -> list[str]:
    pkgs: list[str] = []
    plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}
    for p in plan.get("npm_packages") or []:
        if isinstance(p, str) and p.strip():
            pkgs.append(p.strip())
    stack = state.get("stack_config") if isinstance(state.get("stack_config"), dict) else {}
    if not pkgs and stack.get("package_manager") == "npm":
        pass
    return pkgs[:10]


def _package_in_json(package_json: str, package: str) -> bool:
    try:
        data = json.loads(package_json)
    except json.JSONDecodeError:
        return False
    name = package.split("@")[0]
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        deps = data.get(section) or {}
        if isinstance(deps, dict) and name in deps:
            return True
    return False


async def run_dependency_install(
    settings: Settings,
    state: dict[str, Any],
    port: DevTerminalPort,
) -> dict[str, Any]:
    packages = _packages_from_state(state)
    ctx = state.get("project_context") or {}
    pkg_json = str(
        ctx.get("package_json") or state.get("project_files", {}).get("package.json", "")
    )
    installed: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []
    for pkg in packages:
        if pkg_json and _package_in_json(pkg_json, pkg):
            skipped.append(pkg)
            continue
        cmd = f"npm install {pkg}"
        result: TerminalResult = await port.run(cmd)
        if result.ok:
            installed.append(pkg)
        else:
            errors.append(f"{pkg}: {result.output()[:200]}")
    if not packages and "package.json" in (state.get("project_files") or {}):
        result = await port.run("npm install")
        return {
            "ok": result.ok,
            "ran": True,
            "installed": [],
            "skipped": [],
            "output": result.output()[:2000],
            "errors": [] if result.ok else [result.output()[:500]],
        }
    return {
        "ok": not errors,
        "ran": bool(packages),
        "installed": installed,
        "skipped": skipped,
        "errors": errors,
    }
