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

    s = get_settings().model_copy(update={"desk_tools_local": False, "dev_workflow_terminal_local": False})
    assert resolve_terminal_mode(s, workspace_path="/tmp/ws", conversation_id="cid") == "bridge"


def test_resolve_terminal_mode_dev_workflow_local_sandbox():
    from openpolvointeligence.core.config import get_settings

    s = get_settings().model_copy(update={"desk_tools_local": False, "dev_workflow_terminal_local": True})
    assert resolve_terminal_mode(s, workspace_path="/tmp/ws", conversation_id="cid") == "sandbox"


def test_route_after_type_check_corrective():
    state = {"compile_ok": False, "corrective_attempts": 0}
    assert route_after_type_check(state) == "corrective"


def test_route_after_type_check_continue():
    state = {"compile_ok": True, "corrective_attempts": 0}
    assert route_after_type_check(state) == "continue"


@pytest.mark.asyncio
async def test_load_project_context_greenfield_new_app_uses_memory():
    from unittest.mock import AsyncMock

    settings = Settings()
    bridge_wait = AsyncMock()
    port = DevTerminalPort(
        settings=settings,
        workspace_path="/tmp/ws",
        conversation_id="conv-1",
        project_files={},
        bridge_wait=bridge_wait,
        mode="bridge",
    )
    state = {
        "request_kind": "new_app",
        "workspace_path": "/tmp/ws",
        "workspace_id": "/tmp/ws",
        "project_files": {},
    }
    ctx = await load_project_context(settings, state, port)
    assert ctx.get("stack_detected")
    bridge_wait.assert_not_called()


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
async def test_load_project_context_sandbox_reads_disk(tmp_path):
    """Sandbox usa leitura directa de disco — sem find/cat via shell (Windows-safe)."""
    (tmp_path / "src").mkdir()
    (tmp_path / "package.json").write_text('{"name":"x","dependencies":{"vite":"^5"}}')
    (tmp_path / "src" / "a.ts").write_text("export const a = 1;")
    settings = Settings()
    port = DevTerminalPort(
        settings=settings,
        workspace_path=str(tmp_path),
        conversation_id="conv-1",
        project_files={},
        mode="sandbox",
    )
    state = {"request_kind": "feature", "workspace_path": str(tmp_path), "project_files": {}}
    ctx = await load_project_context(settings, state, port)
    assert "package.json" in (ctx.get("file_tree") or "")
    assert "vite" in (ctx.get("package_json") or "")
    assert ctx.get("stack_detected") == "vite"
    # sem node_modules → nunca corre npx tsc (evita download da rede)
    assert not ctx.get("ts_baseline")


def test_has_local_package(tmp_path):
    from openpolvointeligence.graphs.dev_workflow.tools.node_env import has_local_package

    assert has_local_package(str(tmp_path), "typescript") is False
    pkg = tmp_path / "node_modules" / "typescript"
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text("{}")
    assert has_local_package(str(tmp_path), "typescript") is True


def test_terminal_run_local_kills_process_tree(tmp_path):
    """Timeout mata a árvore inteira — neto segurando o pipe não pendura o communicate."""
    import sys
    import time

    from openpolvointeligence.graphs.desk.desk_tool_logic import _terminal_run_local

    py = sys.executable
    cmd = (
        f'"{py}" -c "import subprocess,sys,time; '
        f"subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)']); "
        f'time.sleep(30)"'
    )
    start = time.monotonic()
    result = _terminal_run_local(str(tmp_path), cmd, timeout_s=2.0)
    elapsed = time.monotonic() - start
    assert result == {"ok": False, "error": "timeout"}
    assert elapsed < 20


@pytest.mark.asyncio
async def test_run_type_check_sandbox_without_node_modules_skips_npx(tmp_path):
    from openpolvointeligence.graphs.dev_workflow.tools.type_checker import run_type_check

    settings = Settings()
    port = MagicMock()
    port.mode = "sandbox"
    port.workspace_path = str(tmp_path)
    port.run = AsyncMock()
    result = await run_type_check(settings, {}, port=port)
    port.run.assert_not_called()
    assert result.get("ok") is True


@pytest.mark.asyncio
async def test_delivery_gate_delete_passes_tsc_skip():
    settings = Settings()
    port = MagicMock()
    port.run = AsyncMock(return_value=TerminalResult(ok=True, stdout=""))
    port.read = MagicMock(return_value="")
    result = await run_delivery_gate_checks(settings, {"project_files": {}}, port, "delete")
    assert result.get("passed") is True
