"""Rotas REST auxiliares do DevAgent Enterprise."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from openpolvointeligence.api.deps import verify_internal_key
from openpolvointeligence.graphs.dev_workflow.api.schemas import (
    DevAgentEventItem,
    DevAgentThreadCreate,
    DevAgentThreadResponse,
    thread_response,
)
from openpolvointeligence.graphs.dev_workflow.runtime.events import get_event_store
from openpolvointeligence.graphs.dev_workflow.runtime.session import get_or_create_session

router = APIRouter(prefix="/dev-agent", tags=["dev-agent"])


@router.post("/threads", response_model=DevAgentThreadResponse)
async def create_thread(
    body: DevAgentThreadCreate,
    _: None = Depends(verify_internal_key),
) -> DevAgentThreadResponse:
    get_or_create_session(body.conversation_id, project_id=body.project_id)
    return thread_response(body.conversation_id, body.project_id)


@router.get("/threads/{conversation_id}/events", response_model=list[DevAgentEventItem])
async def list_thread_events(
    conversation_id: str,
    project_id: str = "",
    _: None = Depends(verify_internal_key),
) -> list[DevAgentEventItem]:
    tid = thread_response(conversation_id, project_id).thread_id
    store = get_event_store()
    return [
        DevAgentEventItem(
            event_id=ev.event_id,
            event_type=ev.event_type,
            timestamp=ev.timestamp,
            payload=ev.payload,
        )
        for ev in store.list_events(tid)
    ]
