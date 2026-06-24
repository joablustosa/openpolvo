"""Testes desk_graph compilação (M1 CORE-2.4)."""

from typing import Any

from openpolvointeligence.core.config import get_settings
import pytest
from langchain_core.messages import AIMessage

from openpolvointeligence.graphs.desk_graph import (
    get_compiled_desk_graph,
    make_tools_node,
    should_continue_tools,
)


def test_compiled_desk_graph():
    g = get_compiled_desk_graph(get_settings())
    assert g is not None


def test_should_continue_tools_with_tool_calls():
    state = {
        "iteration": 1,
        "max_iterations": 8,
        "messages": [AIMessage(content="", tool_calls=[{"name": "filesystem_list", "args": {}, "id": "1"}])],
    }
    assert should_continue_tools(state) == "tools"


def test_should_continue_tools_finalize():
    assert should_continue_tools({"iteration": 9, "max_iterations": 8, "messages": []}) == "finalize"


@pytest.mark.asyncio
async def test_tools_node_preserves_ai_tool_call_before_tool_message(monkeypatch: pytest.MonkeyPatch):
    async def fake_dispatch(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [{"content": "{}", "tool_call_id": "tc-1", "name": "filesystem_list"}]

    monkeypatch.setattr("openpolvointeligence.graphs.desk_graph.dispatch_tool_calls", fake_dispatch)
    node = make_tools_node(get_settings(), bridge_wait=lambda *_: None)
    ai = AIMessage(content="", tool_calls=[{"name": "filesystem_list", "args": {}, "id": "tc-1"}])
    out = await node(
        {
            "messages": [ai],
            "pending_tool_calls": [{"id": "tc-1", "name": "filesystem_list", "args": {}}],
            "trace": [],
            "workspace_path": "",
            "desk_context": {},
        },
    )

    msgs = out.get("messages") or []
    assert len(msgs) == 2
    assert isinstance(msgs[0], AIMessage)
    assert getattr(msgs[1], "tool_call_id", None) == "tc-1"
