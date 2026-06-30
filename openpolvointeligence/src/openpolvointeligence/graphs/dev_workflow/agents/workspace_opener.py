"""Abre o projecto criado no Explorer do editor (pós-implementação)."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import (
    create_project_for_kind,
)
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
    resolve_project_root_for_new_app,
)


def _collect_ops(state: DevWorkflowState) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    for row in state.get("polvo_code_ops") or []:
        if isinstance(row, dict):
            ops.append(row)
    for row in state.get("pending_writes") or []:
        if isinstance(row, dict) and row not in ops:
            ops.append(row)
    return ops


async def run_workspace_opener_agent(
    settings: Settings,
    state: DevWorkflowState,
) -> dict[str, Any]:
    """Marca pedido de abertura do repositório no cliente (sem LLM)."""
    _ = settings
    kind = str(state.get("request_kind") or "")
    has_ws = bool(str(state.get("workspace_id") or "").strip()) or bool(state.get("project_files"))
    create = create_project_for_kind(kind, has_workspace=has_ws) if kind else False
    if not create:
        return step_patch(state, "workspace_opener", {}, agent="workspace_opener")

    root = resolve_project_root_for_new_app(
        create_project=True,
        has_workspace=has_ws,
        project_title=str(state.get("feature_summary") or state.get("user_prompt") or "")[:80]
        or None,
        operations=_collect_ops(state),
    )
    patch: dict[str, Any] = {"polvo_code_open_workspace": True}
    if root:
        patch["polvo_code_project_root"] = root
    return step_patch(state, "workspace_opener", patch, agent="workspace_opener")
