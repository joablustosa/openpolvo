"""Loop ReAct do agente Desk — eventos graph_step/thought + guarda de loop.

Verifica as adições de transparência (raciocínio visível) e o corte de loop
improdutivo, sem LLM real (modelo fake via monkeypatch).
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from openpolvointeligence.core.config import Settings, get_settings
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


# ── Agent node: streaming (delta) + fallback (thought) + guarda ──────────────


class _FakeBound:
    def __init__(self, resp, chunks=None):
        self._resp = resp
        self._chunks = chunks

    async def ainvoke(self, _msgs):
        return self._resp

    async def astream(self, _msgs):
        if self._chunks is None:
            raise RuntimeError("stream indisponível")
        for c in self._chunks:
            yield c


class _FakeChat:
    def __init__(self, resp, chunks=None):
        self._resp = resp
        self._chunks = chunks

    def bind_tools(self, _tools):
        return _FakeBound(self._resp, self._chunks)


def _patch_model(monkeypatch, resp, chunks=None):
    monkeypatch.setattr(desk_graph, "get_chat_model", lambda _s, _mp: _FakeChat(resp, chunks))


@pytest.mark.asyncio
async def test_agent_streams_delta_with_tool_calls(monkeypatch):
    # Stream: texto incremental (delta) + tool_call acumulada; sem `thought`.
    chunks = [
        AIMessageChunk(content="Vou listar "),
        AIMessageChunk(content="os ficheiros."),
        AIMessageChunk(
            content="",
            tool_call_chunks=[{"name": "filesystem_list", "args": "{}", "id": "1", "index": 0}],
        ),
    ]
    _patch_model(monkeypatch, AIMessage(content="ignored"), chunks=chunks)
    events: list[tuple[str, dict]] = []

    async def emit(kind, payload):
        events.append((kind, payload))

    node = make_agent_node(get_settings(), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "openai"})

    kinds = [k for k, _ in events]
    assert "graph_step" in kinds
    assert "delta" in kinds  # streaming token-a-token
    assert "thought" not in kinds  # delta substitui o thought quando há stream
    deltas = "".join(p["text"] for k, p in events if k == "delta")
    assert deltas == "Vou listar os ficheiros."
    assert out["pending_tool_calls"] and out["pending_tool_calls"][0]["name"] == "filesystem_list"
    assert out["tool_signatures"] and "filesystem_list" in out["tool_signatures"][-1]


@pytest.mark.asyncio
async def test_agent_streams_final_answer(monkeypatch):
    chunks = [AIMessageChunk(content="Resposta "), AIMessageChunk(content="final.")]
    _patch_model(monkeypatch, AIMessage(content="ignored"), chunks=chunks)
    events: list[tuple[str, dict]] = []

    async def emit(kind, payload):
        events.append((kind, payload))

    node = make_agent_node(get_settings(), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "openai"})

    deltas = "".join(p["text"] for k, p in events if k == "delta")
    assert deltas == "Resposta final."
    assert "thought" not in [k for k, _ in events]
    assert out["pending_tool_calls"] == []


@pytest.mark.asyncio
async def test_agent_fallback_to_thought_when_stream_unavailable(monkeypatch):
    # Sem astream (chunks=None → raise) → fallback ainvoke; raciocínio sai como `thought`.
    resp = AIMessage(
        content="Vou verificar o git.",
        tool_calls=[{"name": "git_status", "args": {}, "id": "1"}],
    )
    _patch_model(monkeypatch, resp, chunks=None)
    events: list[tuple[str, dict]] = []

    async def emit(kind, payload):
        events.append((kind, payload))

    node = make_agent_node(get_settings(), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "ollama"})

    kinds = [k for k, _ in events]
    assert "thought" in kinds
    assert "delta" not in kinds  # stream falhou antes de emitir
    assert out["pending_tool_calls"][0]["name"] == "git_status"


@pytest.mark.asyncio
async def test_agent_stream_disabled_by_flag(monkeypatch):
    resp = AIMessage(
        content="Reasoning.", tool_calls=[{"name": "git_status", "args": {}, "id": "1"}]
    )
    _patch_model(monkeypatch, resp, chunks=[AIMessageChunk(content="nao usado")])
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    node = make_agent_node(Settings(desk_stream_tokens=False), emit=emit)
    out = await node({"messages": [], "iteration": 0, "model_provider": "openai"})

    assert "delta" not in events  # flag desliga o stream
    assert "thought" in events  # usa ainvoke + thought
    assert out["pending_tool_calls"][0]["name"] == "git_status"


@pytest.mark.asyncio
async def test_agent_without_emit_uses_ainvoke(monkeypatch):
    # emit=None (ex.: get_compiled_desk_graph) → ainvoke, sem quebrar.
    _patch_model(monkeypatch, AIMessage(content="ok"), chunks=[AIMessageChunk(content="x")])
    node = make_agent_node(get_settings())  # emit default None
    out = await node({"messages": [], "iteration": 2, "model_provider": "ollama"})
    assert out["iteration"] == 3
