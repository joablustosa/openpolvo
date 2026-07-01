"""Checklists de entrega por workflow (spec terminal)."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DeliveryGateResult
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import DevTerminalPort


async def _check_tsc(port: DevTerminalPort) -> tuple[bool, str]:
    r = await port.run("npx tsc --noEmit 2>&1")
    out = r.output()
    ok = r.ok and "error TS" not in out
    return ok, "tsc" if ok else f"tsc failed: {out[:200]}"


async def _check_tests(port: DevTerminalPort) -> tuple[bool, str]:
    r = await port.run("npm test 2>&1 | tail -20")
    out = r.output()
    ok = "FAIL" not in out and r.ok
    return ok, "tests" if ok else f"tests failed: {out[:200]}"


async def _check_build(port: DevTerminalPort) -> tuple[bool, str]:
    r = await port.run("npm run build 2>&1 | tail -15")
    out = r.output()
    ok = r.ok and "error" not in out.lower()
    return ok, "build" if ok else f"build failed: {out[:200]}"


def _has_build_script(files: dict[str, Any], port: DevTerminalPort) -> bool:
    """True se package.json declara um script `build` (evita falhar projetos sem build)."""
    import json

    raw = files.get("package.json") or port.read("package.json") or ""
    try:
        return "build" in ((json.loads(raw) or {}).get("scripts") or {})
    except (json.JSONDecodeError, AttributeError, TypeError):
        return False


async def run_delivery_gate_checks(
    settings: Settings,
    state: dict[str, Any],
    port: DevTerminalPort,
    workflow_id: str,
) -> DeliveryGateResult:
    failures: list[str] = []
    checks: list[str] = []
    files = dict(state.get("project_files") or {})

    async def run_check(name: str, fn) -> None:
        checks.append(name)
        ok, msg = await fn()
        if not ok:
            failures.append(msg)

    if workflow_id == "new_app":
        await run_check("tsc", lambda: _check_tsc(port))
        await run_check("build", lambda: _check_build(port))
        await run_check("tests", lambda: _check_tests(port))
        if not files.get(".env.example") and not port.read(".env.example"):
            failures.append("missing .env.example")
        else:
            checks.append("env_example")
        readme = files.get("README.md") or port.read("README.md")
        if len((readme or "").splitlines()) < 20:
            failures.append("README too short")
        else:
            checks.append("readme")
        gs = await port.git_status()
        if not gs.output().strip():
            failures.append("git not initialized")
        else:
            checks.append("git")
    elif workflow_id in ("feature", "edit", "refactor"):
        await run_check("tsc", lambda: _check_tsc(port))
        await run_check("tests", lambda: _check_tests(port))
        diff = await port.git_diff()
        if not diff.output().strip() and not (state.get("pending_writes") or []):
            failures.append("no changes recorded")
        else:
            checks.append("git_diff")
    elif workflow_id == "debug":
        await run_check("tsc", lambda: _check_tsc(port))
        await run_check("tests", lambda: _check_tests(port))
        # Verify reforçado: build só quando existe script (não penaliza projetos sem build).
        if bool(getattr(settings, "dev_workflow_debug_build_check", True)) and _has_build_script(
            files, port
        ):
            await run_check("build", lambda: _check_build(port))
    elif workflow_id == "delete":
        await run_check("tsc", lambda: _check_tsc(port))
    else:
        await run_check("tsc", lambda: _check_tsc(port))

    return {"passed": not failures, "failures": failures, "checks_run": checks}
