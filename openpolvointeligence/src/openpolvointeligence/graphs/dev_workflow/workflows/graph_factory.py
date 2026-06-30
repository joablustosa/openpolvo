"""Factory de subgrafos LangGraph por workflow_id."""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.workflows import (
    api_design_workflow,
    debug_workflow,
    delete_workflow,
    edit_workflow,
    feature_workflow,
    new_app_workflow,
    refactor_workflow,
)
from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import (
    PARALLEL_STEP_GROUPS,
    collapse_parallel_steps,
    make_agent_node,
    make_parallel_node,
    node_deliver,
    node_delivery_gate,
    node_pause_check,
    node_review_gate,
    route_after_delivery,
    route_after_pause,
    route_after_agent_loop,
    route_after_review,
    route_after_type_check,
)

_WORKFLOW_MODULES = (
    new_app_workflow,
    feature_workflow,
    edit_workflow,
    delete_workflow,
    debug_workflow,
    refactor_workflow,
    api_design_workflow,
)

WORKFLOW_STEPS: dict[str, list[str]] = {m.WORKFLOW_ID: list(m.STEPS) for m in _WORKFLOW_MODULES}

_PAUSE_BEFORE: dict[str, bool] = {
    m.WORKFLOW_ID: bool(getattr(m, "PAUSE_BEFORE", False)) for m in _WORKFLOW_MODULES
}


def _step_node_name(key: str) -> str:
    return "step_legacy_core" if key == "legacy_core" else f"step_{key}"


def _next_after_step(steps: list[str], key: str, with_review: bool) -> str:
    idx = steps.index(key)
    if idx + 1 < len(steps):
        return _step_node_name(steps[idx + 1])
    if with_review:
        return "review_gate"
    return "delivery_gate"


def _skip_legacy_target(steps: list[str], with_review: bool) -> str:
    """Destino quando agent_loop salta legacy_core."""
    if "legacy_core" in steps:
        idx = steps.index("legacy_core")
        if idx + 1 < len(steps):
            return _step_node_name(steps[idx + 1])
    if with_review:
        return "review_gate"
    return "delivery_gate"


def build_workflow_graph(settings: Settings, workflow_id: str) -> Any:
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_graph import (
        build_dev_workflow_graph,
    )

    steps = collapse_parallel_steps(list(WORKFLOW_STEPS.get(workflow_id) or WORKFLOW_STEPS["feature"]))
    graph: StateGraph = StateGraph(DevWorkflowState)
    with_review = "review" in steps
    with_pause = bool(_PAUSE_BEFORE.get(workflow_id))
    with_type_check = "type_check" in steps
    with_legacy = "legacy_core" in steps

    if with_pause:
        graph.add_node("pause_check", node_pause_check)
        graph.add_edge(START, "pause_check")

    core_subgraph = build_dev_workflow_graph(settings)
    for key in steps:
        if key == "legacy_core":
            graph.add_node("step_legacy_core", core_subgraph)
        elif key in PARALLEL_STEP_GROUPS:
            graph.add_node(
                _step_node_name(key),
                make_parallel_node(settings, PARALLEL_STEP_GROUPS[key]),
            )
        else:
            graph.add_node(_step_node_name(key), make_agent_node(settings, key))

    if with_type_check:
        graph.add_node("step_corrective", make_agent_node(settings, "corrective"))

    async def delivery_gate_node(state: DevWorkflowState) -> dict[str, Any]:
        return await node_delivery_gate(settings, state)

    graph.add_node("delivery_gate", delivery_gate_node)

    async def deliver_node(state: DevWorkflowState) -> dict[str, Any]:
        return await node_deliver(settings, state)

    graph.add_node("deliver", deliver_node)

    if with_pause:
        graph.add_conditional_edges(
            "pause_check",
            route_after_pause,
            {"end_paused": END, "continue": _step_node_name(steps[0])},
        )
    else:
        graph.add_edge(START, _step_node_name(steps[0]))

    for key in steps:
        cur = _step_node_name(key)
        nxt = _next_after_step(steps, key, with_review)
        if key == "agent_loop":
            graph.add_conditional_edges(
                cur,
                route_after_agent_loop,
                {
                    "legacy_core": "step_legacy_core",
                    "continue": _skip_legacy_target(steps, with_review),
                },
            )
        elif key == "type_check":
            graph.add_conditional_edges(
                cur,
                route_after_type_check,
                {"corrective": "step_corrective", "continue": nxt},
            )
        else:
            graph.add_edge(cur, nxt)

    if with_type_check:
        graph.add_edge("step_corrective", "step_type_check")

    if with_review:
        graph.add_node("review_gate", node_review_gate)
        retry_target = "step_legacy_core" if with_legacy else _step_node_name(steps[0])
        graph.add_conditional_edges(
            "review_gate",
            route_after_review,
            {"legacy_core": retry_target, "deliver": "delivery_gate"},
        )

    delivery_retry = "step_legacy_core" if with_legacy else _step_node_name(steps[0])
    graph.add_conditional_edges(
        "delivery_gate",
        route_after_delivery,
        {"legacy_core": delivery_retry, "deliver": "deliver", "blocked": END},
    )

    graph.add_edge("deliver", END)
    from openpolvointeligence.graphs.dev_workflow.langgraph.checkpoints.saver import (
        compile_with_checkpoint,
    )

    return compile_with_checkpoint(graph, settings)


def _workflow_graph_cache_key(settings: Settings, workflow_id: str) -> tuple[bool, int, str]:
    return (
        bool(getattr(settings, "dev_workflow_team_mode", True)),
        int(getattr(settings, "dev_workflow_max_review_rounds", 3) or 3),
        workflow_id,
    )


_workflow_graph_cache: dict[tuple[bool, int, str], Any] = {}


def get_workflow_graph(settings: Settings, workflow_id: str) -> Any:
    key = _workflow_graph_cache_key(settings, workflow_id)
    cached = _workflow_graph_cache.get(key)
    if cached is not None:
        return cached
    compiled = build_workflow_graph(settings, workflow_id)
    _workflow_graph_cache[key] = compiled
    return compiled


def reset_workflow_graph_cache() -> None:
    _workflow_graph_cache.clear()
