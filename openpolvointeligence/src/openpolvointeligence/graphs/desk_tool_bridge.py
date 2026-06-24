"""Bridge assíncrona para execução de tools no cliente (Electron) — M2 TOOL-4."""

from __future__ import annotations

import asyncio
from typing import Any


class DeskToolBridge:
    """Registo in-memory de resultados de tools enviados pelo frontend."""

    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}

    def register(self, call_id: str) -> asyncio.Future[dict[str, Any]]:
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[call_id] = fut
        return fut

    def submit(self, call_id: str, result: dict[str, Any]) -> bool:
        fut = self._pending.pop(call_id, None)
        if fut is None or fut.done():
            return False
        fut.set_result(result)
        return True

    async def wait(self, call_id: str, *, timeout_s: float = 60.0) -> dict[str, Any]:
        fut = self._pending.get(call_id)
        if fut is None:
            return {"ok": False, "error": "unknown_tool_call_id"}
        try:
            return await asyncio.wait_for(fut, timeout=timeout_s)
        except TimeoutError:
            self._pending.pop(call_id, None)
            return {"ok": False, "error": "tool_result_timeout"}
        except asyncio.CancelledError:
            self._pending.pop(call_id, None)
            raise


# Sessão activa por conversation_id (um stream Desk de cada vez).
_active_bridges: dict[str, DeskToolBridge] = {}


def get_bridge(conversation_id: str) -> DeskToolBridge:
    cid = conversation_id.strip()
    if cid not in _active_bridges:
        _active_bridges[cid] = DeskToolBridge()
    return _active_bridges[cid]


def set_bridge(conversation_id: str, bridge: DeskToolBridge) -> None:
    _active_bridges[conversation_id.strip()] = bridge


def clear_bridge(conversation_id: str) -> None:
    _active_bridges.pop(conversation_id.strip(), None)
