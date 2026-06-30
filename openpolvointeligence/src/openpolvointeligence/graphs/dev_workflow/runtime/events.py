"""Event sourcing leve para streaming."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass
class DevAgentEvent:
    event_id: str
    event_type: str
    payload: dict[str, Any]
    timestamp: str
    thread_id: str = ""

    def to_sse(self) -> dict[str, Any]:
        return {
            "type": "agent_event",
            "event_type": self.event_type,
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "payload": {**self.payload, "thread_id": self.thread_id},
        }


@dataclass
class EventStore:
    """Append-only store in-memory por thread (persistência via checkpoint DB)."""

    _events: dict[str, list[DevAgentEvent]] = field(default_factory=dict)

    def append(
        self,
        thread_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
    ) -> DevAgentEvent:
        ev = DevAgentEvent(
            event_id=str(uuid.uuid4()),
            event_type=event_type,
            payload=dict(payload or {}),
            timestamp=datetime.now(UTC).isoformat(),
            thread_id=thread_id,
        )
        self._events.setdefault(thread_id, []).append(ev)
        return ev

    def list_events(self, thread_id: str) -> list[DevAgentEvent]:
        return list(self._events.get(thread_id, []))


_global_store = EventStore()


def get_event_store() -> EventStore:
    return _global_store


def emit_step_event(
    thread_id: str,
    step: str,
    label: str,
    *,
    agent: str = "",
) -> dict[str, Any]:
    ev = _global_store.append(
        thread_id,
        "step_progress",
        {"step": step, "label": label, "agent": agent or step},
    )
    return ev.to_sse()
