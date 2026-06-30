"""Mapeia request_kind → workflow_id e função de planeamento."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import RequestKind

PlanFn = Callable[..., Awaitable[dict[str, Any]]]

WORKFLOW_BY_KIND: dict[RequestKind, str] = {
    "new_app": "new_app",
    "feature": "feature",
    "bug_fix": "debug",
    "refactor": "refactor",
    "api_design": "api_design",
    "edit": "edit",
    "delete": "delete",
    "explain": "explain",
    "abort": "abort",
}


def workflow_id_for_kind(kind: str) -> str:
    normalized = (kind or "").strip().lower()
    if normalized in WORKFLOW_BY_KIND:
        return WORKFLOW_BY_KIND[normalized]  # type: ignore[index]
    return "feature"


def resolve_plan_runner(kind: str) -> PlanFn:
    """Devolve a função async de planeamento para o tipo de pedido."""
    from openpolvointeligence.graphs.dev_workflow.core import dev_workflow_planning as planning

    mapping: dict[str, PlanFn] = {
        "new_app": planning.run_new_app_plan,
        "feature": planning.run_feature_plan,
        "bug_fix": planning.run_debug_plan,
        "debug": planning.run_debug_plan,
        "refactor": planning.run_refactor_plan,
        "api_design": planning.run_api_design_plan,
        "edit": planning.run_edit_plan,
        "delete": planning.run_delete_plan,
    }
    return mapping.get((kind or "").strip().lower(), planning.run_feature_plan)
