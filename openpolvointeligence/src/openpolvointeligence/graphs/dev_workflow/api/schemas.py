"""API schemas e rotas auxiliares dev-agent."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DevAgentThreadCreate(BaseModel):
    conversation_id: str
    project_id: str = ""


class DevAgentThreadResponse(BaseModel):
    thread_id: str
    conversation_id: str
    project_id: str = ""


class DevAgentEventItem(BaseModel):
    event_id: str
    event_type: str
    timestamp: str
    payload: dict[str, Any] = Field(default_factory=dict)


def thread_response(conversation_id: str, project_id: str = "") -> DevAgentThreadResponse:
    from openpolvointeligence.graphs.dev_workflow.runtime.session import resolve_thread_id

    tid = resolve_thread_id(conversation_id, project_id)
    return DevAgentThreadResponse(
        thread_id=tid,
        conversation_id=conversation_id,
        project_id=project_id,
    )
