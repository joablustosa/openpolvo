"""Helpers partilhados dos agentes DevAgent."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import inject_agent_prompt
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import truncate_trace
from openpolvointeligence.graphs.models import get_chat_model

MAX_RETRIES = 3


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = (
                "\n".join(parts[1:-1])
                if parts[-1].strip().startswith("```")
                else "\n".join(parts[1:])
            )
            return inner.strip()
    return s


def parse_json_object(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


async def invoke_json_agent(
    settings: Settings,
    state: dict[str, Any],
    *,
    agent_name: str,
    human: str,
    extra_system: str = "",
) -> dict[str, Any]:
    from openpolvointeligence.graphs.dev_workflow.engines.context.engine import (
        build_hierarchical_context,
    )

    ctx = build_hierarchical_context(state, agent_key=agent_name)
    ctx_block = ctx.get("context_block") or ""
    human_with_ctx = f"{human}\n\n{ctx_block}" if ctx_block else human
    sys = inject_agent_prompt(agent_name, extra_system, str(state.get("workflow_id") or ""))
    from openpolvointeligence.graphs.dev_workflow.engines.router.matrix import (
        resolve_model_for_node,
    )

    provider = resolve_model_for_node(state.get("model_provider"), agent_name)
    chat = get_chat_model(settings, provider, json_mode=True)
    resp = await chat.ainvoke([SystemMessage(content=sys), HumanMessage(content=human_with_ctx)])
    return parse_json_object(str(resp.content))


def step_patch(
    state: dict[str, Any],
    step: str,
    patch: dict[str, Any],
    *,
    agent: str | None = None,
) -> dict[str, Any]:
    """Marca passo concluído e acumula trace/eventos."""
    trace = truncate_trace(list(state.get("trace") or []))
    completed = list(state.get("completed_steps") or [])
    if step not in completed:
        completed.append(step)
    events = list(state.get("agent_events") or [])
    events.append(
        {
            "type": "step_complete",
            "step": step,
            "agent": agent or step,
        },
    )
    return {
        **patch,
        "current_step": step,
        "completed_steps": completed,
        "agent_events": events,
        "trace": trace + [f"agent:{agent or step}"],
    }
