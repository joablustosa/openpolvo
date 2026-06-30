"""Runner do loop agentico — integração com subgrafos DevAgent."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.loop import run_agent_loop


async def run_agent_loop_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    if not getattr(settings, "dev_workflow_agent_loop_enabled", True):
        return step_patch(
            state,
            "agent_loop",
            {"skip_legacy_core": False, "agent_loop_complete": False},
            agent="agent_loop",
        )
    result = await run_agent_loop(settings, dict(state))
    return step_patch(state, "agent_loop", result, agent="agent_loop")
