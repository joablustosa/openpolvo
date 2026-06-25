"""Entrypoints run_desk_reply / run_desk_reply_stream (M1 CORE-4)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator

import httpx

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk_graph import build_desk_graph
from openpolvointeligence.graphs.desk_routing import (
    desk_conversation_id,
    desk_workspace_path,
)
from openpolvointeligence.graphs.desk_state import initial_desk_state
from openpolvointeligence.graphs.desk_tool_bridge import DeskToolBridge, clear_bridge, set_bridge
from openpolvointeligence.graphs.models import effective_provider, resolve_desk_reply_provider
from openpolvointeligence.graphs.agent_memory_utils import finalize_reply_metadata
from openpolvointeligence.graphs.email_send_reply import try_apply_email_send_metadata
from openpolvointeligence.graphs.message_utils import tail_messages

logger = logging.getLogger(__name__)


def _agent_event(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"type": "agent_event", "event_type": kind, "payload": payload}


_CONNECTION_MARKERS = (
    "connection refused",
    "connect call failed",
    "max retries",
    "failed to connect",
    "connection error",
    "all connection attempts failed",
    "name or service not known",
    "getaddrinfo failed",
    "actively refused",
    "timed out",
    "timeout",
    "newconnectionerror",
    "[winerror 10061]",
)


async def _ollama_reachable(settings: Settings, timeout_s: float = 2.0) -> bool:
    base = (settings.ollama_base_url or "http://127.0.0.1:11434").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(f"{base}/api/tags")
            return r.status_code < 500
    except Exception:  # noqa: BLE001
        return False


def _has_cloud_key(settings: Settings) -> str | None:
    if (settings.openai_api_key or "").strip():
        return "openai"
    if (settings.google_api_key or "").strip():
        return "google"
    return None


_AUTH_MARKERS = (
    "incorrect api key",
    "invalid_api_key",
    "invalid api key",
    "api_key_invalid",
    "unauthorized",
    "error code: 401",
    "status': 401",
    "permission_denied",
    "api key not valid",
)


def _friendly_desk_error(provider: str, settings: Settings, exc: Exception) -> str | None:
    """Mensagem accionável para falhas de ligação/autenticação (None se for outro erro)."""
    raw = str(exc).lower()
    is_conn = any(m in raw for m in _CONNECTION_MARKERS)
    is_auth = any(m in raw for m in _AUTH_MARKERS)
    if is_auth and provider in ("openai", "google"):
        return (
            f"A chave de API do fornecedor **{provider}** foi rejeitada (inválida ou expirada). "
            "Confirme a chave do perfil em Definições → Modelos LLM e volte a guardá-la."
        )
    if provider == "ollama" and ("ollama" in raw or is_conn):
        base = (settings.ollama_base_url or "http://127.0.0.1:11434").rstrip("/")
        return (
            "Não consegui falar com o **Ollama** (modelo local) em "
            f"`{base}`. Verifique se o Ollama está a correr "
            f"(`ollama serve`) e se o modelo `{settings.ollama_model}` está instalado "
            f"(`ollama pull {settings.ollama_model}`).\n\n"
            "Em alternativa, escolha no seletor de modelos um **perfil com chave** "
            "(OpenAI/Gemini) configurado em Definições → Modelos LLM."
        )
    if provider in ("openai", "google") and is_conn:
        return (
            f"Não consegui contactar o fornecedor **{provider}**. Verifique a ligação à "
            "Internet e a chave de API no perfil em Definições → Modelos LLM."
        )
    if is_conn:
        return (
            "Não consegui contactar o modelo de linguagem. Verifique se o Ollama está a "
            "correr ou escolha um perfil com chave (OpenAI/Gemini) em Definições → Modelos LLM."
        )
    return None


async def run_desk_reply(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    desk_context: dict[str, Any] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
    smtp_context: dict[str, Any] | None = None,
    contacts_context: list[dict[str, Any]] | None = None,
    use_local_tools: bool | None = None,
) -> tuple[str, dict[str, Any]]:
    text = ""
    meta: dict[str, Any] = {}
    async for event in run_desk_reply_stream(
        settings,
        messages,
        model_provider,
        desk_context,
        agent_memory=agent_memory,
        smtp_context=smtp_context,
        contacts_context=contacts_context,
        use_local_tools=use_local_tools,
    ):
        if event.get("type") == "done":
            text = str(event.get("assistant_text") or "")
            meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    return text, meta


async def run_desk_reply_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    desk_context: dict[str, Any] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
    smtp_context: dict[str, Any] | None = None,
    contacts_context: list[dict[str, Any]] | None = None,
    use_local_tools: bool | None = None,
) -> AsyncIterator[dict[str, Any]]:
    mp = resolve_desk_reply_provider(model_provider, desk_context, settings)
    wp = desk_workspace_path(desk_context)
    cid = desk_conversation_id(desk_context)
    local_tools = settings.desk_tools_local if use_local_tools is None else use_local_tools

    out_q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    # Fallback automático: se o pedido é Ollama mas o serviço não responde e há
    # chave cloud configurada, troca para o fornecedor cloud em vez de falhar.
    fallback_note: str | None = None
    if mp == "ollama" and not await _ollama_reachable(settings):
        cloud = _has_cloud_key(settings)
        if cloud:
            fallback_note = (
                f"Ollama indisponível — a usar **{cloud}** (perfil com chave) nesta resposta."
            )
            mp = cloud
        else:
            friendly = _friendly_desk_error(
                "ollama",
                settings,
                Exception("connection refused"),
            )
            if friendly:
                meta = {
                    "model_provider": effective_provider("ollama"),
                    "intent": "desk_agent",
                    "error_kind": "llm_unreachable",
                }
                yield {
                    "type": "progress",
                    "step": "desk_start",
                    "label": "A iniciar agente Desk…",
                }
                yield {"type": "done", "assistant_text": friendly, "metadata": meta}
                return

    bridge = DeskToolBridge()
    if cid:
        set_bridge(cid, bridge)

    async def emit(kind: str, payload: dict[str, Any]) -> None:
        await out_q.put(_agent_event(kind, payload))

    async def bridge_wait(
        _conversation_id: str,
        call_id: str,
        payload: dict[str, Any],
        timeout_s: float,
    ) -> dict[str, Any]:
        bridge.register(call_id)
        await out_q.put(
            _agent_event(
                "tool_call",
                {
                    "id": call_id,
                    "tool": payload.get("tool"),
                    "name": payload.get("tool"),
                    "args": payload.get("args") or {},
                    "requires_client": True,
                },
            ),
        )
        return await bridge.wait(call_id, timeout_s=timeout_s)

    graph = build_desk_graph(
        settings,
        bridge_wait=bridge_wait,
        emit=emit,
        use_local=local_tools,
    )

    state_in = initial_desk_state(
        messages=[],
        workspace_path=wp,
        desk_context=desk_context,
        model_provider=mp,
        agent_memory=agent_memory,
        raw_messages=messages,
        smtp_context=smtp_context if isinstance(smtp_context, dict) else None,
    )

    async def run_graph() -> None:
        try:
            await out_q.put(
                {"type": "progress", "step": "desk_start", "label": "A iniciar agente Desk…"}
            )
            if fallback_note:
                await out_q.put(
                    {"type": "progress", "step": "desk_fallback", "label": fallback_note}
                )
            final = await graph.ainvoke(state_in)
            text = str(final.get("assistant_text") or "").strip()
            meta = final.get("metadata") if isinstance(final.get("metadata"), dict) else {}
            capped = tail_messages(messages if isinstance(messages, list) else [], 20)
            meta = await try_apply_email_send_metadata(
                settings,
                mp,
                text,
                capped,
                smtp_context if isinstance(smtp_context, dict) else None,
                contacts_context if isinstance(contacts_context, list) else None,
                meta,
            )
            meta = await finalize_reply_metadata(
                settings,
                mp,
                messages,
                agent_memory,
                meta,
            )
            meta = {**meta, "model_provider": effective_provider(mp), "intent": "desk_agent"}
            await out_q.put(_agent_event("final", {"text": text[:500]}))
            await out_q.put({"type": "done", "assistant_text": text, "metadata": meta})
        except Exception as exc:  # noqa: BLE001
            logger.exception("desk reply stream failed (provider=%s)", mp)
            friendly = _friendly_desk_error(mp, settings, exc)
            if friendly:
                meta = {
                    "model_provider": effective_provider(mp),
                    "intent": "desk_agent",
                    "error": str(exc)[:400],
                    "error_kind": "llm_unreachable",
                }
                await out_q.put({"type": "done", "assistant_text": friendly, "metadata": meta})
            else:
                await out_q.put({"type": "error", "detail": str(exc)[:400]})
        finally:
            await out_q.put(None)

    task = asyncio.create_task(run_graph())
    try:
        while True:
            item = await out_q.get()
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()
        if cid:
            clear_bridge(cid)
