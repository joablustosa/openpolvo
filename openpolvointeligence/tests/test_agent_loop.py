"""Testes do núcleo agentico (loop com histórico + tool-use híbrido)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from langchain_core.messages import AIMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import (
    loop as loop_mod,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import (
    model_bridge as mb,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.tools import (
    execute_agent_tool,
)


class FakeChat:
    """Modelo determinístico: devolve, por turno, o próximo AIMessage do guião."""

    def __init__(self, scripted: list[str]) -> None:
        self._scripted = list(scripted)
        self.seen: list[list[Any]] = []

    def bind_tools(self, _tools: Any) -> "FakeChat":
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        # Guarda o histórico recebido para asserções de persistência.
        self.seen.append(list(messages))
        content = self._scripted.pop(0) if self._scripted else json.dumps(
            {"action": "done", "assistant_reply": "fim"},
        )
        return AIMessage(content=content)


def _settings() -> Settings:
    return Settings()


@pytest.fixture
def patch_json_model(monkeypatch: pytest.MonkeyPatch):
    """Força o caminho JSON (fallback local) com um FakeChat scriptado."""

    def _apply(scripted: list[str]) -> FakeChat:
        fake = FakeChat(scripted)
        monkeypatch.setattr(mb, "supports_native_tools", lambda *a, **k: False)
        monkeypatch.setattr(mb, "get_chat_model", lambda *a, **k: fake)
        return fake

    return _apply


async def test_json_loop_explores_edits_and_completes(patch_json_model):
    fake = patch_json_model(
        [
            json.dumps({"action": "tool", "tool": "read_file", "args": {"path": "src/app.py"}}),
            json.dumps(
                {
                    "action": "tool",
                    "tool": "write_file",
                    "args": {"path": "src/new.py", "content": "print('hello')\n"},
                },
            ),
            json.dumps({"action": "done", "assistant_reply": "Criei src/new.py"}),
        ],
    )
    state = {
        "user_prompt": "cria um módulo novo",
        "project_files": {"src/app.py": "x = 1\n"},
        "model_provider": "openai",
    }
    result = await loop_mod.run_agent_loop(_settings(), state)

    assert result["agent_loop_complete"] is True
    assert result["agent_loop_mode"] == "json"
    assert result["assistant_text"] == "Criei src/new.py"
    ops = {o["path"]: o for o in result["polvo_code_ops"]}
    assert "src/new.py" in ops
    assert ops["src/new.py"]["content"] == "print('hello')\n"
    # Persistência de histórico: no 3.º turno o modelo recebe várias mensagens
    # (system + human + assistant + observação + assistant + observação …), não 2.
    assert len(fake.seen[-1]) > 2


async def test_json_loop_edit_unique_and_reprompt_on_parse_error(patch_json_model):
    patch_json_model(
        [
            "isto não é json",  # parse error → loop reorienta, não quebra
            json.dumps(
                {
                    "action": "tool",
                    "tool": "edit",
                    "args": {
                        "path": "src/app.py",
                        "old_text": "x = 1",
                        "new_text": "x = 2",
                    },
                },
            ),
            json.dumps({"action": "done", "assistant_reply": "ok"}),
        ],
    )
    state = {
        "user_prompt": "muda o valor",
        "project_files": {"src/app.py": "x = 1\n"},
        "model_provider": "openai",
    }
    result = await loop_mod.run_agent_loop(_settings(), state)
    assert result["agent_loop_complete"] is True
    ops = {o["path"]: o for o in result["polvo_code_ops"]}
    assert ops["src/app.py"]["content"] == "x = 2\n"


async def test_native_decision_reads_tool_calls():
    bridge = mb.ModelBridge.__new__(mb.ModelBridge)
    bridge.native = True
    msg = AIMessage(
        content="",
        tool_calls=[{"id": "1", "name": "read_file", "args": {"path": "a.py"}}],
    )
    decision = bridge._decide_native(msg)
    assert decision.finished is False
    assert decision.tool_calls[0]["name"] == "read_file"

    final = AIMessage(content="tudo pronto")
    decision2 = bridge._decide_native(final)
    assert decision2.finished is True
    assert decision2.final_text == "tudo pronto"


async def test_tool_edit_ambiguous_errors():
    files = {"a.py": "v = 1\nv = 1\n"}
    obs, out, ops = await execute_agent_tool(
        _settings(),
        {},
        "edit",
        {"path": "a.py", "old_text": "v = 1", "new_text": "v = 2"},
        project_files=files,
        port=None,
    )
    assert "ambíguo" in obs
    assert ops == []
    assert out["a.py"] == files["a.py"]


async def test_tool_multi_edit_atomic():
    files = {"a.py": "alpha\nbeta\n"}
    obs, out, ops = await execute_agent_tool(
        _settings(),
        {},
        "multi_edit",
        {
            "path": "a.py",
            "edits": [
                {"old_text": "alpha", "new_text": "ALPHA"},
                {"old_text": "NAO_EXISTE", "new_text": "x"},
            ],
        },
        project_files=files,
        port=None,
    )
    # Segunda edição falha → nenhuma aplicada.
    assert "Erro multi_edit" in obs
    assert out["a.py"] == "alpha\nbeta\n"
    assert ops == []


async def test_emit_streams_lifecycle_events(patch_json_model):
    patch_json_model(
        [
            json.dumps(
                {
                    "action": "tool",
                    "tool": "write_file",
                    "args": {"path": "a.txt", "content": "hi"},
                },
            ),
            json.dumps({"action": "done", "assistant_reply": "ok"}),
        ],
    )
    seen: list[tuple[str, dict]] = []

    async def emit(event_type: str, payload: dict) -> None:
        seen.append((event_type, payload))

    state = {"user_prompt": "cria a.txt", "project_files": {}, "model_provider": "openai"}
    await loop_mod.run_agent_loop(_settings(), state, emit=emit)

    types = [t for t, _ in seen]
    assert "agent_loop_start" in types
    assert "tool_call" in types
    assert "file_applied" in types
    assert "agent_loop_complete" in types


async def test_loop_streams_via_terminal_port_emit(patch_json_model):
    from openpolvointeligence.graphs.dev_workflow.tools import terminal_port as tp

    patch_json_model(
        [
            json.dumps(
                {
                    "action": "tool",
                    "tool": "write_file",
                    "args": {"path": "package.json", "content": "{}"},
                },
            ),
            json.dumps({"action": "done", "assistant_reply": "ok"}),
        ],
    )

    class FakePort:
        def __init__(self) -> None:
            self.events: list[tuple[str, dict]] = []

        async def emit(self, kind: str, payload: dict) -> None:
            self.events.append((kind, payload))

        def read(self, _p: str) -> str:
            return ""

    fake = FakePort()
    token = tp.set_terminal_port(fake)  # type: ignore[arg-type]
    try:
        state = {"user_prompt": "cria app", "project_files": {}, "model_provider": "openai"}
        await loop_mod.run_agent_loop(_settings(), state)
    finally:
        tp.reset_terminal_port(token)

    types = [t for t, _ in fake.events]
    # Streaming ao vivo pelo canal do terminal port (fila SSE em produção).
    assert "agent_loop_start" in types
    assert "tool_call" in types
    assert "file_applied" in types
    assert "preview" in types  # package.json tocado → sinaliza dev-server ao front
    assert "agent_loop_complete" in types


async def test_task_subagent_delegates(monkeypatch):
    async def fake_subrun(settings, sub_state, *, max_iterations=None, depth=0, emit=None):
        # Simula um subagente que criou um ficheiro.
        return {
            "project_files": {**sub_state.get("project_files", {}), "sub.py": "x=1\n"},
            "polvo_code_ops": [{"op": "write", "path": "sub.py", "content": "x=1\n"}],
            "assistant_text": "subagente concluiu",
        }

    monkeypatch.setattr(loop_mod, "run_agent_loop", fake_subrun)
    obs, files, ops = await execute_agent_tool(
        _settings(),
        {"project_files": {}},
        "task",
        {"subagent_type": "implementer", "prompt": "cria sub.py"},
        project_files={},
        port=None,
        depth=0,
    )
    assert "subagente" in obs.lower()
    assert files["sub.py"] == "x=1\n"
    assert ops and ops[0]["path"] == "sub.py"


async def test_task_subagent_depth_guard():
    obs, _, ops = await execute_agent_tool(
        _settings(),
        {},
        "task",
        {"subagent_type": "implementer", "prompt": "x"},
        project_files={},
        port=None,
        depth=1,
    )
    assert "profundidade" in obs.lower()
    assert ops == []


async def test_tool_glob_and_todo():
    files = {"src/a.tsx": "", "src/b.ts": "", "readme.md": ""}
    obs, _, _ = await execute_agent_tool(
        _settings(), {}, "glob", {"pattern": "src/**/*.tsx"},
        project_files=files, port=None,
    )
    assert "src/a.tsx" in obs and "readme.md" not in obs

    obs2, _, ops2 = await execute_agent_tool(
        _settings(), {}, "todo_write",
        {"todos": [{"content": "passo 1", "status": "completed"}]},
        project_files=files, port=None,
    )
    assert "[x] passo 1" in obs2 and ops2 == []
