"""Sub-agentes de terminal — type check, lint, test, git, dependency, migration."""

from __future__ import annotations

import re
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import (
    CompileErrorDigest,
    DevWorkflowState,
)
from openpolvointeligence.graphs.dev_workflow.tools.code_executor import run_tests
from openpolvointeligence.graphs.dev_workflow.tools.dependency import run_dependency_install
from openpolvointeligence.graphs.dev_workflow.tools.git import git_commit
from openpolvointeligence.graphs.dev_workflow.tools.linter import run_linter
from openpolvointeligence.graphs.dev_workflow.tools.migration import run_migration
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    build_terminal_port,
    get_terminal_port,
)
from openpolvointeligence.graphs.dev_workflow.tools.type_checker import run_type_check


def _merged_files(state: DevWorkflowState) -> dict[str, str]:
    files = dict(state.get("project_files") or {})
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            files[str(w["path"])] = str(w.get("content") or "")
    return files


def _parse_tsc_errors(output: str) -> list[CompileErrorDigest]:
    errors: list[CompileErrorDigest] = []
    for line in output.splitlines()[:30]:
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


def _port(settings: Settings, state: DevWorkflowState):
    return get_terminal_port() or build_terminal_port(
        settings, dict(state), bridge_wait=None, emit=None
    )


async def run_type_check_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    files = _merged_files(state)
    result = await run_type_check(settings, files, port=port)
    ok = bool(result.get("ok"))
    errors = list(result.get("errors") or [])
    if not errors and not ok:
        errors = _parse_tsc_errors(str(result.get("output") or ""))
    patch: dict[str, Any] = {
        "type_check_result": result,
        "compile_ok": ok,
        "error_digest": errors,
    }
    if not ok:
        terr = list(state.get("terminal_errors") or [])
        terr.append(
            {
                "agent": "type_check",
                "type": "typescript",
                "message": str(result.get("output") or "")[:2000],
                "retryable": True,
            },
        )
        patch["terminal_errors"] = terr
    return step_patch(state, "type_check", patch, agent="type_check")


async def run_lint_fix_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    files = _merged_files(state)
    pending = list(state.get("pending_writes") or [])
    eslint = await port.run("npx eslint src --ext .ts,.tsx --fix 2>&1 | head -50")
    static = run_linter(files, pending_writes=pending)
    result = {
        "ok": bool(static.get("ok")) and eslint.ok,
        "eslint": eslint.output()[:2000],
        "static_verify": static,
    }
    return step_patch(state, "lint_fix", {"lint_result": result}, agent="lint_fix")


async def run_test_runner_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    files = _merged_files(state)
    if port.mode == "bridge":
        tr = await port.run("npm test 2>&1 | tail -30")
        result = {
            "ok": tr.ok,
            "ran": True,
            "output": tr.output()[:4000],
            "mode": "bridge",
        }
    else:
        result = await run_tests(settings, files)
    baseline = str((state.get("project_context") or {}).get("ts_baseline") or "")
    out = str(result.get("output") or "")
    result["new_failures"] = "FAIL" in out and "FAIL" not in baseline
    return step_patch(state, "test_runner", {"test_result": result}, agent="test_runner")


async def run_git_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    wf = str(state.get("workflow_id") or "dev")
    kind = str(state.get("request_kind") or "change")
    scope = str(state.get("feature_summary") or kind)[:40]
    msg = state.get("commit_message") or f"feat({scope}): {kind} via DevAgent"
    result = await git_commit(
        port,
        str(msg),
        agent="git",
        workflow=wf,
        session=str(state.get("conversation_id") or "")[:12],
    )
    return step_patch(state, "git", {"git_result": result}, agent="git")


async def run_dependency_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    result = await run_dependency_install(settings, dict(state), port)
    return step_patch(state, "dependency", {"dependency_result": result}, agent="dependency")


async def run_migration_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = _port(settings, state)
    result = await run_migration(settings, dict(state), port)
    return step_patch(state, "migration", {"migration_result": result}, agent="migration")
