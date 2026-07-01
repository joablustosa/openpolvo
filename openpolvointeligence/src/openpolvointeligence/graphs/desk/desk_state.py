"""Estado LangGraph do agente Desk (M1 CORE-1)."""

from __future__ import annotations

from typing import Any, TypedDict

from langchain_core.messages import BaseMessage

from openpolvointeligence.graphs.dev_workflow.dev_workflow_state import truncate_trace

__all__ = ["DeskAgentState", "truncate_trace", "initial_desk_state"]


class DeskAgentState(TypedDict, total=False):
    """Estado partilhado do grafo Desk — ReAct com tools locais."""

    messages: list[BaseMessage]
    iteration: int
    max_iterations: int
    trace: list[str]
    workspace_path: str
    desk_context: dict[str, Any]
    model_provider: str
    assistant_text: str
    metadata: dict[str, Any]
    pending_tool_calls: list[dict[str, Any]]
    # Assinaturas (nome+args) das tool_calls por ronda — guarda contra loop improdutivo.
    tool_signatures: list[str]
    agent_memory: dict[str, Any]
    _raw_messages: list[dict[str, Any]]
    smtp_context: dict[str, Any]


def initial_desk_state(
    *,
    messages: list[BaseMessage],
    workspace_path: str,
    desk_context: dict[str, Any] | None,
    model_provider: str,
    agent_memory: dict[str, Any] | None = None,
    raw_messages: list[dict[str, Any]] | None = None,
    smtp_context: dict[str, Any] | None = None,
    max_iterations: int = 8,
) -> DeskAgentState:
    return {
        "messages": messages,
        "iteration": 0,
        "max_iterations": max_iterations,
        "trace": [],
        "workspace_path": workspace_path,
        "desk_context": desk_context or {},
        "model_provider": model_provider,
        "assistant_text": "",
        "metadata": {},
        "pending_tool_calls": [],
        "agent_memory": agent_memory or {},
        "_raw_messages": raw_messages or [],
        "smtp_context": smtp_context or {},
    }
