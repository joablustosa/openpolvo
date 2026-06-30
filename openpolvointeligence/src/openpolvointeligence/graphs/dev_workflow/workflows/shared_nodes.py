"""Nós partilhados dos subgrafos DevAgent."""

from __future__ import annotations

from typing import Any, Callable, Awaitable

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import MAX_RETRIES
from openpolvointeligence.graphs.dev_workflow.agents.runners import AGENT_RUNNERS
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import (
    create_project_for_kind,
)
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import (
    DevWorkflowState,
    truncate_trace,
)
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    build_terminal_port,
    get_terminal_port,
)
from openpolvointeligence.graphs.dev_workflow.workflows.delivery_gates import (
    run_delivery_gate_checks,
)
from openpolvointeligence.graphs.dev_workflow.engines.memory.store import (
    merge_project_learning,
)
from openpolvointeligence.graphs.dev_workflow.engines.planner.dag import (
    merge_plan_into_state,
)
from openpolvointeligence.graphs.dev_workflow.engines.patch.ops import (
    normalize_and_validate_ops,
)

AgentFn = Callable[[Settings, DevWorkflowState], Awaitable[dict[str, Any]]]


def make_parallel_node(settings: Settings, agent_keys: list[str]) -> AgentFn:
    """Executa agentes independentes em paralelo (ex.: lint_fix + test_runner)."""

    async def node(state: DevWorkflowState) -> dict[str, Any]:
        from openpolvointeligence.graphs.dev_workflow.engines.execution.parallel import (
            run_parallel_steps,
        )

        events = list(state.get("agent_events") or [])
        for key in agent_keys:
            events.append({"type": "step_start", "step": key, "agent": key})

        async def _run_one(key: str) -> dict[str, Any]:
            runner = AGENT_RUNNERS[key]
            st: DevWorkflowState = {**state, "agent_events": list(events)}
            return await runner(settings, st)

        merged = await run_parallel_steps(
            {key: (lambda k=key: _run_one(k)) for key in agent_keys},
        )
        return merged

    return node


PARALLEL_STEP_GROUPS: dict[str, list[str]] = {
    "lint_test_parallel": ["lint_fix", "test_runner"],
}


def collapse_parallel_steps(steps: list[str]) -> list[str]:
    """Substitui lint_fix + test_runner consecutivos por grupo paralelo."""
    out: list[str] = []
    i = 0
    while i < len(steps):
        if (
            i + 1 < len(steps)
            and steps[i] == "lint_fix"
            and steps[i + 1] == "test_runner"
        ):
            out.append("lint_test_parallel")
            i += 2
        else:
            out.append(steps[i])
            i += 1
    return out


def make_agent_node(settings: Settings, agent_key: str) -> AgentFn:
    runner = AGENT_RUNNERS[agent_key]

    async def node(state: DevWorkflowState) -> dict[str, Any]:
        events = list(state.get("agent_events") or [])
        events.append({"type": "step_start", "step": agent_key, "agent": agent_key})
        st: DevWorkflowState = {**state, "agent_events": events}
        return await runner(settings, st)

    return node


async def node_pause_check(state: DevWorkflowState) -> dict[str, Any]:
    """Pausa se clarificações ou impacto crítico."""
    trace = truncate_trace(list(state.get("trace") or []))
    clar = list(state.get("pending_clarifications") or [])
    impact = state.get("impact_report") or state.get("impact_analysis") or {}
    risk = str(impact.get("risk") or "").lower() if isinstance(impact, dict) else ""
    if clar or risk == "critical":
        events = list(state.get("agent_events") or [])
        events.append({"type": "pause_for_input", "step": "pause", "agent": "gateway"})
        return {
            "paused": True,
            "assistant_text": (
                "Preciso de confirmação antes de continuar: "
                + (clar[0] if clar else "impacto crítico detectado.")
            ),
            "agent_events": events,
            "trace": trace + ["workflow:pause"],
        }
    return {"paused": False, "trace": trace + ["workflow:pause:skip"]}


async def node_review_gate(state: DevWorkflowState) -> dict[str, Any]:
    review = state.get("review_result") or {}
    approved = True
    if isinstance(review, dict) and "approved" in review:
        approved = bool(review.get("approved"))
    retries = int(state.get("review_retries") or 0)
    trace = truncate_trace(list(state.get("trace") or []))
    if approved:
        return {"trace": trace + ["workflow:review:ok"]}
    if retries >= MAX_RETRIES:
        return {
            "assistant_text": "Revisão bloqueou a entrega após várias tentativas.",
            "trace": trace + ["workflow:review:blocked"],
        }
    return {
        "review_retries": retries + 1,
        "trace": trace + [f"workflow:review:retry:{retries + 1}"],
    }


def route_after_agent_loop(state: DevWorkflowState) -> str:
    """Se o loop agentico concluiu com ops válidas, salta legacy_core."""
    if state.get("skip_legacy_core") and state.get("agent_loop_complete"):
        return "continue"
    return "legacy_core"


def route_after_review(state: DevWorkflowState) -> str:
    review = state.get("review_result") or {}
    if isinstance(review, dict) and review.get("approved") is False:
        if int(state.get("review_retries") or 0) < MAX_RETRIES:
            return "legacy_core"
    return "deliver"


def route_after_type_check(state: DevWorkflowState) -> str:
    tc = state.get("type_check_result") or {}
    ok = state.get("compile_ok")
    if ok is None and isinstance(tc, dict):
        ok = tc.get("ok")
    if ok is not False:
        return "continue"
    attempts = int(state.get("corrective_attempts") or 0)
    if attempts < MAX_RETRIES:
        return "corrective"
    return "continue"


def route_after_delivery(state: DevWorkflowState) -> str:
    gate = state.get("delivery_gate_result") or {}
    if isinstance(gate, dict) and gate.get("passed") is False:
        retries = int(state.get("delivery_gate_retries") or 0)
        if retries < MAX_RETRIES:
            return "legacy_core"
        return "blocked"
    return "deliver"


async def node_delivery_gate(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    port = get_terminal_port() or build_terminal_port(
        settings, dict(state), bridge_wait=None, emit=None
    )
    wf = str(state.get("workflow_id") or "feature")
    result = await run_delivery_gate_checks(settings, dict(state), port, wf)
    trace = truncate_trace(list(state.get("trace") or []))
    patch: dict[str, Any] = {
        "delivery_gate_result": result,
        "trace": trace + [f"workflow:delivery_gate:{result.get('passed')}"],
    }
    if not result.get("passed"):
        retries = int(state.get("delivery_gate_retries") or 0)
        patch["delivery_gate_retries"] = retries + 1
        from openpolvointeligence.graphs.dev_workflow.engines.repair.loop import (
            repair_patch,
            should_attempt_repair,
        )

        if should_attempt_repair({**state, **patch}):
            patch.update(repair_patch(dict(state), "delivery_gate_failed"))
    return patch


def route_after_pause(state: DevWorkflowState) -> str:
    if state.get("paused"):
        return "end_paused"
    return "continue"


async def node_deliver(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    """Finaliza metadata e polvo_code_ops."""
    trace = truncate_trace(list(state.get("trace") or []))
    ops = list(state.get("polvo_code_ops") or [])
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w not in ops:
            ops.append(w)
    valid, verr = validate_polvo_code_operations(ops)
    kind = str(state.get("request_kind") or "")
    has_ws = bool(str(state.get("workspace_id") or "").strip()) or bool(state.get("project_files"))
    create = create_project_for_kind(kind, has_workspace=has_ws) if kind else False
    plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}
    wf_id = str(state.get("workflow_id") or "feature")
    ops_out, _, root = normalize_and_validate_ops(
        valid,
        create_project=create,
        has_workspace=has_ws,
        project_title=str(state.get("feature_summary") or "")[:80] or None,
    )
    meta = build_polvo_code_ops_metadata(
        bool(valid),
        ops_out or valid,
        verr,
        create_project=create,
        project_title=str(state.get("feature_summary") or "")[:80] or None,
        npm_install=create or any(str(o.get("path", "")).endswith("package.json") for o in valid),
        has_workspace=has_ws,
        stack=str(plan.get("stack") or state.get("stack_hint") or "") or None,
        design_tokens=plan.get("design_tokens")
        if isinstance(plan.get("design_tokens"), dict)
        else None,
    )
    assistant = str(state.get("assistant_text") or "").strip()
    if not assistant:
        assistant = "Alterações aplicadas ao projecto."
    deliverable = {
        "summary": assistant[:500],
        "files_changed": [str(o.get("path")) for o in valid if o.get("path")],
        "workflow_id": str(state.get("workflow_id") or ""),
        "request_kind": kind,
    }
    dw = dict(meta.get("dev_workflow") or {})
    dw.update(
        {
            "workflow_id": state.get("workflow_id"),
            "execution_plan": state.get("execution_plan"),
            "impact_analysis": state.get("impact_analysis"),
            "review_result": state.get("review_result"),
            "completed_steps": state.get("completed_steps"),
        },
    )
    meta["dev_workflow"] = dw
    if state.get("polvo_code_open_workspace"):
        meta["polvo_code_open_workspace"] = True
    if state.get("polvo_code_project_root"):
        meta["polvo_code_project_root"] = state["polvo_code_project_root"]
    plan_patch = merge_plan_into_state(state, wf_id)
    out = {
        "assistant_text": assistant,
        "metadata": meta,
        "polvo_code_ops": ops_out or valid,
        "deliverable": deliverable,
        "trace": trace + ["workflow:deliver"],
        **plan_patch,
    }
    return merge_project_learning(state, out)
