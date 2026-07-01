"""Loop ReAct do agente Desk — eventos graph_step/thought + guarda de loop.

Verifica as adições de transparência (raciocínio visível) e o corte de loop
improdutivo, sem LLM real (modelo fake via monkeypatch).
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.desk import desk_graph
from openpolvointeligence.graphs.desk.desk_graph import (
    is_unproductive_loop,
    make_agent_node,
    should_continue_tools,
    tool_calls_signature,
)


# ── Assinatura de tool_calls ─────────────────────────────────────────────────


def test_tool_signature_stable_and_empty():
    ai = AIMessage(
        content="", tool_calls=[{"name": "filesystem_list", "args": {"rel_path": "src"}, "id": "1"}]
    )
    sig = tool_calls_signature(ai)
    assert "filesystem_list" in sig
    # Estável: mesmo conteúdo → mesma assinatura.
    assert sig == tool_calls_signature(
        AIMessage(
            content="x",
            tool_calls=[{"name": "filesystem_list", "args": {"rel_path": "src"}, "id": "2"}],
        )
    )
    # Sem tool_calls → vazio.
    assert tool_calls_signature(AIMessage(content="resposta final")) == ""


# ── Guarda de loop improdutivo ───────────────────────────────────────────────


def test_is_unproductive_loop():
    assert is_unproductive_loop([]) is False
    assert is_unproductive_loop(["a", "a"]) is False  # < limite
    assert is_unproductive_loop(["a", "b", "a"]) is False  # variado
    assert is_unproductive_loop(["a", "a", "a"]) is True  # 3 iguais
    assert is_unproductive_loop(["", "", ""]) is False  # vazias não contam


def test_should_continue_finalizes_on_loop():
    state = {
        "iteration": 3,
        "max_iterations": 8,
        "messages": [
            AIMessage(content="", tool_calls=[{"name": "git_status", "args": {}, "id": "1"}])
        ],
        "tool_signatures": ["git_status:{}", "git_status:{}", "git_status:{}"],
    }
    assert should_continue_tools(state) == "finalize"


def test_should_continue_tools_when_not_looping():
    state = {
        "iteration": 1,
        "max_iterations": 8,
        "messages": [
            AIMessage(content="", tool_calls=[{"name": "git_status", "args": {}, "id": "1"}])
        ],
        "tool_signatures": ["git_status:{}"],
    }
    assert should_continue_tools(state) == "tools"


# ── Agent node: emite graph_step + thought e rastreia assinaturas ────────────


class _FakeBound:
    def __init__(self, resp):
        self._resp = resp

    async def ainvoke(self, _msgs):
        return self._resp


class _FakeChat:
    def __init__(self, resp):
        self._resp = resp

    def bind_tools(self, _tools):
        return _FakeBound(self._resp)


def _patch_model(monkeypatch, resp):
    monkeypatch.setattr(desk_graph, "get_chat_model", lambda _s, _mp: _FakeChat(resp))


@pytest.mark.asyncio
async def test_agent_emits_graph_step_and_thought(monkeypatch):
    resp = AIMessage(
        content="Vou listar os ficheiros primeiro.",
        tool_calls=[{"name": "filesystem_list", "args": {}, "id": "1"}],
    )
    _patch_model(monkeypatch, resp)
    events: list[tuple[str, dict]] = []

    async def emit(kind, payload):
        events.append((kind, payload))

    node = make_agent_node(get_settings(), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "ollama"})

    kinds = [k for k, _ in events]
    assert "graph_step" in kinds
    assert "thought" in kinds
    thought = next(p for k, p in events if k == "thought")
    assert "listar os ficheiros" in thought["text"]
    # Assinatura rastreada para a guarda de loop.
    assert out["tool_signatures"] and "filesystem_list" in out["tool_signatures"][-1]
    assert out["iteration"] == 1


@pytest.mark.asyncio
async def test_agent_no_thought_when_final_answer(monkeypatch):
    # Sem tool_calls → é a resposta final; não deve emitir `thought`.
    _patch_model(monkeypatch, AIMessage(content="Aqui está a resposta final."))
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    node = make_agent_node(get_settings(), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "ollama"})

    assert "graph_step" in events
    assert "thought" not in events
    assert out["pending_tool_calls"] == []


@pytest.mark.asyncio
async def test_agent_without_emit_does_not_fail(monkeypatch):
    # emit=None (ex.: get_compiled_desk_graph) não deve quebrar.
    _patch_model(monkeypatch, AIMessage(content="ok"))
    node = make_agent_node(get_settings())  # emit default None
    out = await node({"messages": [], "iteration": 2, "model_provider": "ollama"})
    assert out["iteration"] == 3
