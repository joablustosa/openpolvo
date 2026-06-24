"""Testes desk tool bridge (M2 TOOL-4.4)."""

import asyncio

import pytest

from openpolvointeligence.graphs.desk_tool_bridge import DeskToolBridge


@pytest.mark.asyncio
async def test_bridge_submit_and_wait():
    bridge = DeskToolBridge()
    call_id = "call-1"

    async def waiter():
        bridge.register(call_id)
        return await bridge.wait(call_id, timeout_s=2.0)

    task = asyncio.create_task(waiter())
    await asyncio.sleep(0.05)
    assert bridge.submit(call_id, {"ok": True, "output": "pong"})
    result = await task
    assert result["ok"] is True
    assert result["output"] == "pong"
