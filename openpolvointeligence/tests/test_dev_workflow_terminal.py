"""Testes terminal + context loader + gates."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.context_loader import load_project_context
from openpolvointeligence.graphs.dev_workflow.tools.file_output_parser import parse_generated_files
from openpolvointeligence.graphs.dev_workflow.tools.filesystem import (
    grep_in_memory,
    list_files_in_memory,
)
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    DevTerminalPort,
    TerminalResult,
    resolve_terminal_mode,
)
from openpolvointeligence.graphs.dev_workflow.workflows.delivery_gates import (
    run_delivery_gate_checks,
)
from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import route_after_type_check


def test_early_project_root_progress_new_app():
    from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (
        _early_project_root_progress,
    )

    state = {
        "request_kind": "new_app",
        "user_prompt": "criar app de tarefas",
        "workspace_path": "/tmp/ws",
    }
    ev, root = _early_project_root_progress(state, "/tmp/ws")
    assert ev is not None
    assert root
    assert ev["step"] == "dev_project_root"


def test_grep_in_memory():
    files = {"src/a.ts": "export const Foo = 1;\nimport { Bar } from './b';"}
    out = grep_in_memory(files, "export const", globs=["ts"])
    assert "src/a.ts" in out


def test_list_files_in_memory():
    files = {"src/a.ts": "", "src/b.tsx": "", "lib/c.ts": ""}
    out = list_files_in_memory(files, prefix="src")
    assert "src/a.ts" in out
    assert "lib/c.ts" not in out


def test_parse_generated_files():
    raw = """%%FILE_START%%
path: src/foo.ts
action: create
%%CONTENT_START%%
export const x = 1;
%%CONTENT_END%%
%%FILE_END%%"""
    ops = parse_generated_files(raw)
    assert len(ops) == 1
    assert ops[0]["path"] == "src/foo.ts"
    assert "export const x" in ops[0]["content"]


def test_progress_event_heartbeat_labels():
    from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (
        _WORKFLOW_STEP_LABELS,
        _progress_event,
    )

    ev = _progress_event("dev_workflow", _WORKFLOW_STEP_LABELS)
    assert ev["type"] == "progress"
    assert ev["step"] == "dev_heartbeat"


def test_flatten_stream_chunk_subgraph_tuple():
    from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (
        _flatten_stream_chunk,
    )

    chunk = (("step_legacy_core:abc",), {"step_context_loader": {"project_context": {}}})
    flat = _flatten_stream_chunk(chunk)
    assert any(name == "step_context_loader" for name, _ in flat)


def test_flatten_stream_chunk_plain_dict():
    from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (
        _flatten_stream_chunk,
    )

    flat = _flatten_stream_chunk({"classify": {"request_kind": "feature"}})
    assert flat == [("classify", {"request_kind": "feature"})]


def test_flatten_stream_chunk_nested_subgraph_tuple():
    from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (
        _flatten_stream_chunk,
    )

    chunk = (("ns",), {"legacy_core": ("architect", {"pending_writes": [{"op": "write"}]})})
    flat = _flatten_stream_chunk(chunk)
    assert any(name == "architect" for name, _ in flat)
    s = Settings()
    assert resolve_terminal_mode(s, workspace_path=None, conversation_id=None) == "memory"


def test_resolve_terminal_mode_bridge():
    from openpolvointeligence.core.config import get_settings

    s = get_settings().model_copy(update={"desk_tools_local": False})
    assert resolve_terminal_mode(s, workspace_path="/tmp/ws", conversation_id="cid") == "bridge"


def test_route_after_type_check_corrective():
    state = {"compile_ok": False, "corrective_attempts": 0}
    assert route_after_type_check(state) == "corrective"


def test_route_after_type_check_continue():
    state = {"compile_ok": True, "corrective_attempts": 0}
    assert route_after_type_check(state) == "continue"


@pytest.mark.asyncio
async def test_load_project_context_memory():
    settings = Settings()
    port = DevTerminalPort(
        settings=settings,
        workspace_path="",
        conversation_id=None,
        project_files={
            "package.json": '{"name":"app","dependencies":{"vite":"^5"}}',
            "src/index.ts": "export const main = () => 1;",
        },
        mode="memory",
    )
    ctx = await load_project_context(settings, {}, port)
    assert ctx.get("package_json")
    assert ctx.get("stack_detected") in ("node", "vite")


@pytest.mark.asyncio
async def test_delivery_gate_delete_passes_tsc_skip():
    settings = Settings()
    port = MagicMock()
    port.run = AsyncMock(return_value=TerminalResult(ok=True, stdout=""))
    port.read = MagicMock(return_value="")
    result = await run_delivery_gate_checks(settings, {"project_files": {}}, port, "delete")
    assert result.get("passed") is True
