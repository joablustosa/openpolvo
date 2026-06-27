"""Testes desk_routing (M1 CORE-4.1)."""

from openpolvointeligence.graphs.desk.desk_routing import (
    desk_workspace_path,
    should_use_desk_graph,
)


def test_should_use_desk_graph_true():
    assert should_use_desk_graph({"mode": "agent", "workspace_path": "/x"})


def test_should_use_desk_graph_false():
    assert not should_use_desk_graph(None)
    assert not should_use_desk_graph({})
    assert not should_use_desk_graph({"mode": "flow"})


def test_desk_workspace_path():
    assert desk_workspace_path({"workspace_path": "  /repo  "}) == "/repo"
