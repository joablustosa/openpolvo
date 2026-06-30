"""Testes dos motores Dev Agent Enterprise."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.engines.planner.dag import (
    build_execution_dag,
    merge_plan_into_state,
)
from openpolvointeligence.graphs.dev_workflow.engines.router.matrix import (
    resolve_model_for_node,
    tier_for_node,
)
from openpolvointeligence.graphs.dev_workflow.engines.symbols.graph import (
    SymbolGraph,
    build_symbol_graph_from_state,
)
from openpolvointeligence.graphs.dev_workflow.runtime.events import emit_step_event
from openpolvointeligence.graphs.dev_workflow.runtime.session import resolve_thread_id
from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import (
    collapse_parallel_steps,
)


def test_resolve_thread_id_with_project() -> None:
    assert resolve_thread_id("conv-1", "proj-a") == "conv-1:proj-a"


def test_collapse_parallel_lint_test() -> None:
    steps = ["type_check", "lint_fix", "test_runner", "git"]
    assert collapse_parallel_steps(steps) == [
        "type_check",
        "lint_test_parallel",
        "git",
    ]


def test_execution_dag_parallel_group() -> None:
    dag = build_execution_dag(["lint_fix", "test_runner", "review"])
    assert ["lint_fix", "test_runner"] in dag["parallel_groups"]


def test_merge_plan_into_state() -> None:
    out = merge_plan_into_state({}, "new_app")
    assert "execution_dag" in out


def test_model_router_tiers() -> None:
    assert tier_for_node("architect") == "strong"
    assert tier_for_node("lint_fix") == "fast"
    assert resolve_model_for_node("auto", "architect") == "openai"
    assert resolve_model_for_node("anthropic", "lint_fix") == "anthropic"


def test_symbol_graph_from_state() -> None:
    state = {
        "project_files": {
            "src/a.ts": "export function foo() {}\nexport const bar = 1;",
        },
    }
    sg = build_symbol_graph_from_state(state)
    assert isinstance(sg, SymbolGraph)
    assert sg.nodes


def test_emit_step_event() -> None:
    ev = emit_step_event("t1", "dev_lint", "Lint", agent="lint_fix")
    assert ev["type"] == "agent_event"
    assert ev["event_type"] == "step_progress"
