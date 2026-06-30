"""Runners dos 17 agentes DevAgent."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.agent_loop_runner import (
    run_agent_loop_agent,
)
from openpolvointeligence.graphs.dev_workflow.agents.agent_context import (
    build_agent_context_block,
)
from openpolvointeligence.graphs.dev_workflow.agents.base import invoke_json_agent, step_patch
from openpolvointeligence.graphs.dev_workflow.agents.context_loader import run_context_loader_agent
from openpolvointeligence.graphs.dev_workflow.agents.corrective_agent import run_corrective_agent
from openpolvointeligence.graphs.dev_workflow.agents.terminal_agents import (
    run_dependency_agent,
    run_git_agent,
    run_lint_fix_agent,
    run_migration_agent,
    run_test_runner_agent,
    run_type_check_agent,
)
from openpolvointeligence.graphs.dev_workflow.agents.workspace_opener import (
    run_workspace_opener_agent,
)
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.dev_workflow_review_logic import parse_review_response
from openpolvointeligence.graphs.dev_workflow.tools.code_executor import run_script

_AGENT_HUMAN_LIMIT = 6000


def _human_base(state: DevWorkflowState) -> str:
    prompt = str(state.get("user_prompt") or state.get("enriched_prompt") or "")[
        :_AGENT_HUMAN_LIMIT
    ]
    ctx = build_agent_context_block(dict(state))
    return f"## Pedido\n{prompt}{ctx}"


async def run_requirements_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    data = await invoke_json_agent(
        settings, state, agent_name="requirements", human=_human_base(state)
    )
    reqs = {
        k: data.get(k)
        for k in (
            "functional_requirements",
            "non_functional_requirements",
            "business_rules",
            "user_stories",
            "out_of_scope",
            "assumptions",
            "clarifications_needed",
        )
        if k in data
    }
    patch: dict[str, Any] = {"requirements": reqs}
    clar = reqs.get("clarifications_needed")
    if isinstance(clar, list) and clar:
        patch["pending_clarifications"] = [str(c) for c in clar[:5]]
    return step_patch(state, "requirements", patch, agent="requirements")


async def run_stack_selector_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    data = await invoke_json_agent(
        settings, state, agent_name="stack_selector", human=_human_base(state)
    )
    stack_cfg = data.get("stack_config") if isinstance(data.get("stack_config"), dict) else {}
    stack_id = stack_cfg.get("stack_id") or state.get("stack_hint") or "fullstack-mixed"
    if not stack_cfg:
        stack_cfg = {
            "stack_id": stack_id,
            "frontend": "vite-react",
            "backend": "hono",
            "database": "pglite",
            "package_manager": "npm",
        }
    return step_patch(
        state,
        "stack_selector",
        {"stack_config": stack_cfg, "stack_hint": stack_id},
        agent="stack_selector",
    )


async def run_impact_analyzer_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    if state.get("impact_analysis"):
        return step_patch(state, "impact_analyzer", {}, agent="impact_analyzer")
    from openpolvointeligence.graphs.dev_workflow.engines.symbols.graph import (
        build_symbol_graph_from_state,
    )

    sg = build_symbol_graph_from_state(state)
    symbol_hints = list(sg.nodes.keys())[:20]
    data = await invoke_json_agent(
        settings, state, agent_name="impact_analyzer", human=_human_base(state)
    )
    impact = data.get("impact_analysis") if isinstance(data.get("impact_analysis"), dict) else data
    if isinstance(impact, dict) and symbol_hints:
        impact["symbol_hints"] = symbol_hints
    return step_patch(
        state,
        "impact_analyzer",
        {"impact_analysis": impact, "impact_report": impact, "symbol_graph": sg.to_dict()},
        agent="impact_analyzer",
    )


async def run_review_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    human = (
        _human_base(state)
        + f"\n\n## Ficheiros gerados\n{len(state.get('pending_writes') or [])} ops"
    )
    data = await invoke_json_agent(settings, state, agent_name="review", human=human)
    if "approved" in data:
        review = {
            "approved": bool(data.get("approved")),
            "blockers": data.get("blockers") or [],
            "warnings": data.get("warnings") or [],
            "suggestions": data.get("suggestions") or [],
            "score": float(data.get("score") or (1.0 if data.get("approved") else 0.0)),
        }
    else:
        import json

        review = parse_review_response(json.dumps(data, ensure_ascii=False))
    return step_patch(
        state,
        "review",
        {"review_result": review, "code_approved": review.get("approved")},
        agent="review",
    )


async def run_delete_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    data = await invoke_json_agent(settings, state, agent_name="delete", human=_human_base(state))
    ops_raw = data.get("operations") or []
    ops: list[dict[str, Any]] = []
    for row in ops_raw if isinstance(ops_raw, list) else []:
        if isinstance(row, dict) and row.get("op") == "delete" and row.get("path"):
            ops.append({"op": "delete", "path": str(row["path"])})
    patch: dict[str, Any] = {"polvo_code_ops": ops, "pending_writes": ops}
    if data.get("assistant_reply"):
        patch["assistant_text"] = str(data["assistant_reply"])
    return step_patch(state, "delete_executor", patch, agent="delete")


async def run_code_executor_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    files = dict(state.get("project_files") or {})
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            files[str(w["path"])] = str(w.get("content") or "")
    result = await run_script(settings, files)
    return step_patch(
        state, "code_executor", {"execution_results": [result]}, agent="code_executor"
    )


async def run_legacy_core_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    """Delega codegen/build/heal ao pipeline core existente."""
    if state.get("skip_legacy_core") and state.get("agent_loop_complete"):
        trace = list(state.get("trace") or []) + ["legacy_core:skipped:agent_loop"]
        return step_patch(
            state,
            "legacy_core",
            {"trace": trace, "current_step": "legacy_core"},
            agent="legacy_core",
        )
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_graph import build_dev_workflow_graph

    graph = build_dev_workflow_graph(settings)
    merged = dict(state)
    merged.setdefault("route", "architect")
    if str(state.get("request_kind")) in ("edit", "bug_fix"):
        merged["route"] = "patch"
        merged["use_diff_mode"] = True
    result: dict[str, Any] = dict(merged)
    async for chunk in graph.astream(merged):
        for _node, patch in chunk.items():
            if isinstance(patch, dict):
                result.update(patch)
    if not isinstance(result, dict):
        return step_patch(state, "legacy_core", {}, agent="legacy_core")
    trace = list(state.get("trace") or []) + list(result.get("trace") or [])
    result["trace"] = trace
    result["current_step"] = "legacy_core"
    completed = list(state.get("completed_steps") or [])
    if "legacy_core" not in completed:
        completed.append("legacy_core")
    result["completed_steps"] = completed
    return result


# Agentes especializados que reutilizam o core com scope implícito no state
async def run_architect_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_frontend_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_backend_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_database_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_auth_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_devops_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_test_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    from openpolvointeligence.graphs.dev_workflow.tools.code_executor import run_tests

    files = dict(state.get("project_files") or {})
    result = await run_tests(settings, files)
    return step_patch(state, "test", {"test_result": result}, agent="test")


async def run_edit_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    st = dict(state)
    st["use_diff_mode"] = True
    st["route"] = "patch"
    return await run_legacy_core_agent(settings, st)  # type: ignore[arg-type]


async def run_debug_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


async def run_refactor_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    st = dict(state)
    st["use_diff_mode"] = True
    return await run_legacy_core_agent(settings, st)  # type: ignore[arg-type]


async def run_api_design_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await run_legacy_core_agent(settings, state)


AGENT_RUNNERS: dict[str, Any] = {
    "context_loader": run_context_loader_agent,
    "requirements": run_requirements_agent,
    "stack_selector": run_stack_selector_agent,
    "impact_analyzer": run_impact_analyzer_agent,
    "architect": run_architect_agent,
    "frontend": run_frontend_agent,
    "backend": run_backend_agent,
    "database": run_database_agent,
    "auth": run_auth_agent,
    "devops": run_devops_agent,
    "test": run_test_agent,
    "type_check": run_type_check_agent,
    "lint_fix": run_lint_fix_agent,
    "test_runner": run_test_runner_agent,
    "git": run_git_agent,
    "workspace_opener": run_workspace_opener_agent,
    "dependency": run_dependency_agent,
    "migration": run_migration_agent,
    "corrective": run_corrective_agent,
    "review": run_review_agent,
    "edit": run_edit_agent,
    "delete": run_delete_agent,
    "debug": run_debug_agent,
    "refactor": run_refactor_agent,
    "api_design": run_api_design_agent,
    "code_executor": run_code_executor_agent,
    "legacy_core": run_legacy_core_agent,
    "agent_loop": run_agent_loop_agent,
}
