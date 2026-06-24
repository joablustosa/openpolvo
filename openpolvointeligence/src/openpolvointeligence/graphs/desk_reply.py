"""Entrypoints run_desk_reply / run_desk_reply_stream (M1 CORE-4)."""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk_graph import build_desk_graph
from openpolvointeligence.graphs.desk_routing import (
    desk_conversation_id,
    desk_workspace_path,
)
from openpolvointeligence.graphs.desk_state import initial_desk_state
from openpolvointeligence.graphs.desk_tool_bridge import DeskToolBridge, clear_bridge, set_bridge
from openpolvointeligence.graphs.models import desk_effective_provider, effective_provider
from openpolvointeligence.graphs.agent_memory_utils import finalize_reply_metadata


def _agent_event(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"type": "agent_event", "event_type": kind, "payload": payload}


async def run_desk_reply(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    desk_context: dict[str, Any] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
    use_local_tools: bool | None = None,
) -> tuple[str, dict[str, Any]]:
    text = ""
    meta: dict[str, Any] = {}
    async for event in run_desk_reply_stream(
        settings,
        messages,
        model_provider,
        desk_context,
        agent_memory=agent_memory,
        use_local_tools=use_local_tools,
    ):
        if event.get("type") == "done":
            text = str(event.get("assistant_text") or "")
            meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    return text, meta


async def run_desk_reply_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    desk_context: dict[str, Any] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
    use_local_tools: bool | None = None,
) -> AsyncIterator[dict[str, Any]]:
    mp = desk_effective_provider(model_provider, settings)
    wp = desk_workspace_path(desk_context)
    cid = desk_conversation_id(desk_context)
    local_tools = settings.desk_tools_local if use_local_tools is None else use_local_tools

    bridge = DeskToolBridge()
    if cid:
        set_bridge(cid, bridge)

    out_q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(kind: str, payload: dict[str, Any]) -> None:
        await out_q.put(_agent_event(kind, payload))

    async def bridge_wait(
        _conversation_id: str,
        call_id: str,
        payload: dict[str, Any],
        timeout_s: float,
    ) -> dict[str, Any]:
        bridge.register(call_id)
        await out_q.put(
            _agent_event(
                "tool_call",
                {
                    "id": call_id,
                    "tool": payload.get("tool"),
                    "name": payload.get("tool"),
                    "args": payload.get("args") or {},
                    "requires_client": True,
                },
            ),
        )
        return await bridge.wait(call_id, timeout_s=timeout_s)

    graph = build_desk_graph(
        settings,
        bridge_wait=bridge_wait,
        emit=emit,
        use_local=local_tools,
    )

    state_in = initial_desk_state(
        messages=[],
        workspace_path=wp,
        desk_context=desk_context,
        model_provider=mp,
        agent_memory=agent_memory,
        raw_messages=messages,
    )

    async def run_graph() -> None:
        try:
            await out_q.put(
                {"type": "progress", "step": "desk_start", "label": "A iniciar agente Desk…"}
            )
            final = await graph.ainvoke(state_in)
            text = str(final.get("assistant_text") or "").strip()
            meta = final.get("metadata") if isinstance(final.get("metadata"), dict) else {}
            meta = await finalize_reply_metadata(
                settings,
                mp,
                messages,
                agent_memory,
                meta,
            )
            meta = {**meta, "model_provider": effective_provider(mp), "intent": "desk_agent"}
            await out_q.put(_agent_event("final", {"text": text[:500]}))
            await out_q.put({"type": "done", "assistant_text": text, "metadata": meta})
        except Exception as exc:  # noqa: BLE001
            await out_q.put({"type": "error", "detail": str(exc)[:400]})
        finally:
            await out_q.put(None)

    task = asyncio.create_task(run_graph())
    try:
        while True:
            item = await out_q.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
        if cid:
            clear_bridge(cid)
