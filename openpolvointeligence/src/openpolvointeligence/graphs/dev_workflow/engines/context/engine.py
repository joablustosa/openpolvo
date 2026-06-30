"""Context Engine — hierarquia Global → Project → Turn → Agent."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.agents.agent_context import (
    build_agent_context_block,
)
from openpolvointeligence.graphs.dev_workflow.engines.context.budget import (
    DEFAULT_SLICE_BUDGETS,
    clip_text,
)


def _project_slice(state: dict[str, Any]) -> str:
    ctx = state.get("project_context") or {}
    if not isinstance(ctx, dict):
        return ""
    parts: list[str] = []
    for key in ("stack", "frameworks", "entry_points", "ts_baseline"):
        val = ctx.get(key)
        if val:
            parts.append(f"{key}: {val}")
    manifest = state.get("file_manifest") or []
    if manifest:
        parts.append(f"files: {len(manifest)} tracked")
    return clip_text("\n".join(parts), DEFAULT_SLICE_BUDGETS["project"])


def _turn_slice(state: dict[str, Any]) -> str:
    prompt = str(state.get("enriched_prompt") or state.get("user_prompt") or "")
    kind = str(state.get("request_kind") or "")
    wf = str(state.get("workflow_id") or "")
    body = f"kind={kind} workflow={wf}\n{prompt}"
    return clip_text(body, DEFAULT_SLICE_BUDGETS["turn"])


def build_hierarchical_context(
    state: dict[str, Any],
    *,
    agent_key: str = "",
) -> dict[str, Any]:
    """Constrói slices hierárquicos e bloco injectável para agentes."""
    global_slice = clip_text(
        "OpenPolvo DevAgent — código real, validação estática e build.",
        DEFAULT_SLICE_BUDGETS["global"],
    )
    project_slice = _project_slice(state)
    turn_slice = _turn_slice(state)
    agent_block = build_agent_context_block(state)
    agent_slice = clip_text(agent_block, DEFAULT_SLICE_BUDGETS["agent"])
    combined = "\n\n".join(
        s for s in (global_slice, project_slice, turn_slice, agent_slice) if s
    )
    return {
        "context_slices": {
            "global": global_slice,
            "project": project_slice,
            "turn": turn_slice,
            "agent": agent_slice,
            "agent_key": agent_key,
        },
        "context_block": combined,
        "compact_context_map": {
            **(state.get("compact_context_map") or {}),
            "hierarchical": True,
        },
    }
