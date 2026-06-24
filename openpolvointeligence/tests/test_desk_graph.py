"""Testes desk_graph compilação (M1 CORE-2.4)."""

from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.desk_graph import get_compiled_desk_graph, should_continue_tools


def test_compiled_desk_graph():
    g = get_compiled_desk_graph(get_settings())
    assert g is not None


def test_should_continue_tools_with_tool_calls():
    from langchain_core.messages import AIMessage

    state = {
        "iteration": 1,
        "max_iterations": 8,
        "messages": [AIMessage(content="", tool_calls=[{"name": "filesystem_list", "args": {}, "id": "1"}])],
    }
    assert should_continue_tools(state) == "tools"


def test_should_continue_tools_finalize():
    assert should_continue_tools({"iteration": 9, "max_iterations": 8, "messages": []}) == "finalize"
