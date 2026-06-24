"""Contrato Desk MVP — schemas pydantic (M0 DESK-0.4)."""

import json

from openpolvointeligence.api.schemas import AgentEventPayload, DeskContext, ReplyRequest


def test_desk_context_schema_roundtrip():
    dc = DeskContext(
        mode="agent",
        workspace_path="/tmp/ws",
        conversation_id="conv-1",
        model_provider="ollama",
    )
    raw = dc.model_dump()
    assert raw["mode"] == "agent"
    restored = DeskContext.model_validate(raw)
    assert restored.workspace_path == "/tmp/ws"


def test_reply_request_desk_context():
    body = ReplyRequest.model_validate(
        {
            "messages": [{"role": "user", "content": "olá"}],
            "model_provider": "ollama",
            "desk_context": {
                "mode": "agent",
                "workspace_path": "C:\\repo",
                "conversation_id": "id-1",
            },
        },
    )
    assert body.desk_context is not None
    assert body.desk_context["mode"] == "agent"


def test_agent_event_payload_json():
    ev = AgentEventPayload(type="tool_call", payload={"id": "1", "tool": "filesystem_list"})
    s = json.dumps(ev.model_dump())
    data = json.loads(s)
    assert data["type"] == "tool_call"
    assert data["payload"]["tool"] == "filesystem_list"
