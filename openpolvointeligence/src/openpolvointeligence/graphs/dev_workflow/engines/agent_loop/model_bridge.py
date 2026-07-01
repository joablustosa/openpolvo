"""Ponte de modelo do loop agentico — tool-calling nativo com fallback modo-JSON.

Abstrai a diferença entre providers fortes (OpenAI/Gemini: tool-calling nativo) e
modelos locais fracos (Ollama: uma acção JSON por turno), devolvendo sempre a mesma
``LoopDecision``. O loop (`loop.py`) fica agnóstico ao provider.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.schemas import (
    TOOL_SCHEMAS,
    render_tool_catalog,
)
from openpolvointeligence.graphs.models import get_chat_model, supports_native_tools

_logger = logging.getLogger(__name__)


@dataclass
class LoopDecision:
    """Resultado normalizado de um turno do modelo."""

    assistant_message: BaseMessage
    tool_calls: list[dict[str, Any]] = field(default_factory=list)  # [{id,name,args}]
    final_text: str = ""
    finished: bool = False
    # Operações passadas explicitamente pelo modelo (só no caminho JSON "done").
    explicit_operations: list[dict[str, Any]] = field(default_factory=list)


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = (
                "\n".join(parts[1:-1])
                if parts[-1].strip().startswith("```")
                else "\n".join(parts[1:])
            )
            return inner.strip()
    return s


def parse_json_action(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"action": "error", "detail": "JSON inválido"}
    return data if isinstance(data, dict) else {"action": "error", "detail": "não é objecto"}


class ModelBridge:
    """Encapsula o modelo e o modo (nativo/JSON) para o loop."""

    def __init__(self, settings: Settings, provider: str | None) -> None:
        self.settings = settings
        self.provider = provider
        self.native = supports_native_tools(settings, provider)
        if self.native:
            base = get_chat_model(settings, provider)
            try:
                self.chat = base.bind_tools(TOOL_SCHEMAS)
            except Exception as exc:  # provider/modelo não aceita bind_tools
                _logger.info("bind_tools indisponível (%s); fallback JSON", exc)
                self.native = False
                self.chat = get_chat_model(settings, provider, json_mode=True)
        else:
            self.chat = get_chat_model(settings, provider, json_mode=True)

    @property
    def mode(self) -> str:
        return "native" if self.native else "json"

    def system_suffix(self) -> str:
        """Instruções de protocolo específicas do modo, anexadas ao system."""
        if self.native:
            return (
                "\n\n## Protocolo\n"
                "Usa as ferramentas fornecidas (tool calls nativos). Quando a tarefa "
                "estiver concluída e verificada, responde com uma mensagem final de "
                "texto (sem tool calls) a resumir o que foi feito."
            )
        return (
            "\n\n## Protocolo (responde SEMPRE um único objecto JSON)\n"
            "Uma acção por turno.\n\n"
            "Ferramenta:\n"
            '`{"action":"tool","tool":"<nome>","args":{...},"thought":"curto"}`\n\n'
            "Concluir (tarefa terminada e verificada):\n"
            '`{"action":"done","assistant_reply":"resumo",'
            '"operations":[{"op":"write","path":"...","content":"..."}]}`\n\n'
            "Em `done`, `operations` é opcional — as escritas já feitas via ferramentas "
            "são acumuladas automaticamente.\n\n"
            f"## Ferramentas\n{render_tool_catalog()}"
        )

    async def decide(
        self, messages: list[BaseMessage], *, emit=None, thread_id: str = ""
    ) -> LoopDecision:
        resp = await self._invoke(messages, emit)
        if self.native:
            return self._decide_native(resp)
        return self._decide_json(resp)

    async def _invoke(self, messages: list[BaseMessage], emit) -> BaseMessage:
        """Invoca o modelo; streama tokens (evento text_delta) em modo nativo quando há emit.

        Só streama em modo nativo — em modo JSON a saída é uma ação JSON, não prosa.
        Fallback para ``ainvoke`` (sem duplicar texto) se o stream falhar.
        """
        stream = (
            self.native
            and emit is not None
            and bool(getattr(self.settings, "dev_workflow_stream_tokens", True))
        )
        if not stream:
            return await self.chat.ainvoke(messages)
        full: AIMessageChunk | None = None
        emitted = False
        try:
            async for chunk in self.chat.astream(messages):
                full = chunk if full is None else full + chunk
                piece = _chunk_text(chunk)
                if piece:
                    emitted = True
                    try:
                        await emit("text_delta", {"delta": piece})
                    except Exception:  # noqa: BLE001 — emit nunca deve quebrar o loop
                        pass
        except Exception:  # noqa: BLE001 — stream instável cai para ainvoke
            _logger.info("agent_loop astream falhou; a usar ainvoke", exc_info=True)
            if full is None and not emitted:
                return await self.chat.ainvoke(messages)
        if full is None:
            return await self.chat.ainvoke(messages)
        return AIMessage(
            content=full.content,
            tool_calls=list(getattr(full, "tool_calls", []) or []),
            additional_kwargs=dict(getattr(full, "additional_kwargs", {}) or {}),
        )

    def _decide_native(self, resp: BaseMessage) -> LoopDecision:
        tool_calls = list(getattr(resp, "tool_calls", None) or [])
        norm: list[dict[str, Any]] = []
        for tc in tool_calls:
            norm.append(
                {
                    "id": str(tc.get("id") or uuid.uuid4().hex),
                    "name": str(tc.get("name") or ""),
                    "args": tc.get("args") if isinstance(tc.get("args"), dict) else {},
                },
            )
        if norm:
            return LoopDecision(assistant_message=resp, tool_calls=norm, finished=False)
        text = _content_text(resp)
        return LoopDecision(assistant_message=resp, final_text=text, finished=True)

    def _decide_json(self, resp: BaseMessage) -> LoopDecision:
        raw = _content_text(resp)
        action = parse_json_action(raw)
        act = str(action.get("action") or "").lower()
        if act == "done":
            reply = str(action.get("assistant_reply") or "").strip()
            ops = action.get("operations")
            ops_list = [o for o in ops if isinstance(o, dict)] if isinstance(ops, list) else []
            return LoopDecision(
                assistant_message=AIMessage(content=raw),
                final_text=reply,
                finished=True,
                explicit_operations=ops_list,
            )
        if act == "tool":
            tc = {
                "id": uuid.uuid4().hex,
                "name": str(action.get("tool") or ""),
                "args": action.get("args") if isinstance(action.get("args"), dict) else {},
            }
            return LoopDecision(
                assistant_message=AIMessage(content=raw),
                tool_calls=[tc],
                finished=False,
            )
        # parse_error / acção desconhecida — devolve sem tool calls; o loop injecta a correcção.
        return LoopDecision(
            assistant_message=AIMessage(content=raw),
            tool_calls=[],
            finished=False,
        )

    def tool_result_message(self, tool_call: dict[str, Any], observation: str) -> BaseMessage:
        """Constrói a mensagem de resultado, no formato certo para o modo."""
        if self.native:
            return ToolMessage(
                content=observation,
                tool_call_id=str(tool_call.get("id") or ""),
                name=str(tool_call.get("name") or ""),
            )
        # JSON: modelos fracos lêem melhor observações como texto humano.
        return HumanMessage(
            content=f"## Observação [{tool_call.get('name')}]\n{observation}",
        )


def _content_text(msg: BaseMessage) -> str:
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return str(content or "")


def _chunk_text(chunk: Any) -> str:
    """Texto incremental de um AIMessageChunk (string ou blocos de texto)."""
    c = getattr(chunk, "content", "")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(
            p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""
