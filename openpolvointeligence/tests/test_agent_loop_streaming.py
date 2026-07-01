"""Streaming token-a-token no loop de dev (ModelBridge.decide) — stream + fallback.

Sem LLM real: substitui `bridge.chat` por um fake com astream/ainvoke.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.model_bridge import ModelBridge


class _FakeChat:
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


def _bridge(settings, *, native, chat) -> ModelBridge:
    b = ModelBridge.__new__(ModelBridge)
    b.settings = settings
    b.provider = "openai"
    b.native = native
    b.chat = chat
    return b


@pytest.mark.asyncio
async def test_native_streams_text_delta():
    chunks = [
        AIMessageChunk(content="A analisar "),
        AIMessageChunk(content="o código."),
    ]
    bridge = _bridge(Settings(), native=True, chat=_FakeChat(AIMessage(content="x"), chunks))
    events: list[tuple[str, dict]] = []

    async def emit(kind, payload):
        events.append((kind, payload))

    decision = await bridge.decide([], emit=emit)
    deltas = "".join(p["delta"] for k, p in events if k == "text_delta")
    assert deltas == "A analisar o código."
    assert decision.finished is True
    assert decision.final_text == "A analisar o código."


@pytest.mark.asyncio
async def test_native_streams_and_keeps_tool_calls():
    chunks = [
        AIMessageChunk(content="Vou editar."),
        AIMessageChunk(
            content="",
            tool_call_chunks=[{"name": "write_file", "args": "{}", "id": "1", "index": 0}],
        ),
    ]
    bridge = _bridge(Settings(), native=True, chat=_FakeChat(AIMessage(content="x"), chunks))
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    decision = await bridge.decide([], emit=emit)
    assert "text_delta" in events
    assert decision.finished is False
    assert decision.tool_calls and decision.tool_calls[0]["name"] == "write_file"


@pytest.mark.asyncio
async def test_fallback_to_ainvoke_when_stream_unavailable():
    resp = AIMessage(content="Resposta via ainvoke.")
    bridge = _bridge(Settings(), native=True, chat=_FakeChat(resp, chunks=None))
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    decision = await bridge.decide([], emit=emit)
    assert "text_delta" not in events  # stream falhou antes de emitir
    assert decision.final_text == "Resposta via ainvoke."


@pytest.mark.asyncio
async def test_json_mode_does_not_stream():
    # Modo JSON (Ollama fraco): não streama prosa, usa ainvoke.
    resp = AIMessage(content='{"action": "done", "assistant_reply": "pronto"}')
    bridge = _bridge(
        Settings(), native=False, chat=_FakeChat(resp, chunks=[AIMessageChunk(content="x")])
    )
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    decision = await bridge.decide([], emit=emit)
    assert "text_delta" not in events
    assert decision.finished is True


@pytest.mark.asyncio
async def test_flag_disables_stream():
    resp = AIMessage(content="Sem stream.")
    bridge = _bridge(
        Settings(dev_workflow_stream_tokens=False),
        native=True,
        chat=_FakeChat(resp, chunks=[AIMessageChunk(content="x")]),
    )
    events: list[str] = []

    async def emit(kind, _payload):
        events.append(kind)

    decision = await bridge.decide([], emit=emit)
    assert "text_delta" not in events
    assert decision.final_text == "Sem stream."


@pytest.mark.asyncio
async def test_no_emit_uses_ainvoke():
    resp = AIMessage(content="ok")
    bridge = _bridge(
        Settings(), native=True, chat=_FakeChat(resp, chunks=[AIMessageChunk(content="x")])
    )
    decision = await bridge.decide([], emit=None)
    assert decision.final_text == "ok"
