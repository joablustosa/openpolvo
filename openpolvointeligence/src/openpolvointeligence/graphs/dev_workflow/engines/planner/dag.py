"""Auto Planner — DAG de execução."""

from __future__ import annotations

from typing import Any


def build_execution_dag(steps: list[str]) -> dict[str, Any]:
    """Constrói DAG linear com hints de paralelismo."""
    nodes = [{"id": s, "deps": [steps[i - 1]] if i else []} for i, s in enumerate(steps)]
    parallel_groups: list[list[str]] = []
    if "lint_fix" in steps and "test_runner" in steps:
        parallel_groups.append(["lint_fix", "test_runner"])
    return {"nodes": nodes, "parallel_groups": parallel_groups}


def merge_plan_into_state(state: dict[str, Any], workflow_id: str) -> dict[str, Any]:
    from openpolvointeligence.graphs.dev_workflow.workflows.graph_factory import (
        WORKFLOW_STEPS,
    )

    steps = list(WORKFLOW_STEPS.get(workflow_id) or [])
    dag = build_execution_dag(steps)
    return {"execution_dag": dag, "execution_plan": state.get("execution_plan") or {}}
