"""Testes do loop agentico DevAgent."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.model_bridge import (
    parse_json_action as _parse_action,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.patch import (
    apply_search_replace,
)
from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import (
    route_after_agent_loop,
)


def test_parse_action_tool() -> None:
    raw = '{"action": "tool", "tool": "read_file", "args": {"path": "a.ts"}}'
    data = _parse_action(raw)
    assert data["action"] == "tool"
    assert data["tool"] == "read_file"


def test_parse_action_done() -> None:
    raw = '{"action": "done", "operations": [{"op": "write", "path": "x.ts", "content": "x"}]}'
    data = _parse_action(raw)
    assert data["action"] == "done"
    assert len(data["operations"]) == 1


def test_apply_search_replace() -> None:
    files = {"src/a.ts": "const x = 1;\n"}
    updated, err = apply_search_replace(files, "src/a.ts", "const x = 1;", "const x = 2;")
    assert err is None
    assert "const x = 2;" in updated["src/a.ts"]


def test_route_after_agent_loop_skips_legacy() -> None:
    assert route_after_agent_loop({"skip_legacy_core": True, "agent_loop_complete": True}) == "continue"


def test_route_after_agent_loop_uses_legacy() -> None:
    assert route_after_agent_loop({}) == "legacy_core"
