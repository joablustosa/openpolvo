"""Grafo LangGraph: resposta rica em conversa (prompt → pesquisa → síntese → blocos)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.agent_memory_utils import finalize_reply_metadata
from openpolvointeligence.graphs.conversation.conversation_reply_blocks_logic import (
    apply_rich_format_to_reply,
    blocks_to_plain_text,
    normalize_enriched_brief,
    normalize_rich_blocks,
    parse_enriched_brief_json,
    parse_rich_blocks_json,
)
from openpolvointeligence.graphs.conversation.conversation_reply_state import ConversationReplyState
from openpolvointeligence.graphs.message_utils import (
    conversation_summary,
    last_user_text,
    tail_messages,
)
from openpolvointeligence.graphs.models import effective_provider, get_chat_model

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "conversation_reply"


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int = 18_000) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def build_conversation_reply_graph(settings: Settings) -> Any:
    improver_sys = _load_prompt("prompt_improver_system")
    synthesizer_sys = _load_prompt("synthesizer_system")
    formatter_sys = _load_prompt("formatter_system")

    async def node_improve_prompt(state: ConversationReplyState) -> dict[str, Any]:
        raw = state.get("user_query") or ""
        summary = state.get("conv_summary") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = f"PEDIDO:\n{raw}\n\nHISTÓRICO:\n{summary}\n\nDevolve o JSON do brief."
        resp = await chat.ainvoke(
            [SystemMessage(content=improver_sys), HumanMessage(content=human)],
        )
        brief = normalize_enriched_brief(parse_enriched_brief_json(str(resp.content)), raw=raw)
        return {
            "enriched_brief": brief,
            "trace": list(state.get("trace") or []) + ["improve_prompt"],
        }

    async def node_research(state: ConversationReplyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        trace = list(state.get("trace") or []) + ["research"]
        if not brief.get("needs_research"):
            return {
                "research_dossier": "Pesquisa web não necessária para este pedido.",
                "trace": trace,
            }
        serp_key = (settings.serpapi_api_key or "").strip()
        queries = brief.get("research_queries") or []
        if not serp_key or not queries:
            return {
                "research_dossier": (
                    "Sem pesquisa web automática (SERPAPI ou queries ausentes). "
                    "Usar conhecimento do modelo com premissas explícitas."
                ),
                "trace": trace,
            }
        try:
            from openpolvointeligence.graphs.web_research.web_research_serpapi import fetch_organic_snippets

            parts: list[str] = []
            for q in queries[:3]:
                block = await fetch_organic_snippets(
                    api_key=serp_key,
                    query=str(q),
                    engine="duckduckgo",
                    max_results=5,
                )
                if block.strip():
                    parts.append(f"### {q}\n{block.strip()}")
            dossier = (
                "\n\n".join(parts) if parts else "Pesquisa não devolveu resultados utilizáveis."
            )
        except Exception as exc:
            _logger.warning("conversation research failed: %s", exc)
            dossier = f"Pesquisa indisponível ({exc})."
        return {"research_dossier": _clip(dossier), "trace": trace}

    async def node_synthesize(state: ConversationReplyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        dossier = state.get("research_dossier") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        human = (
            f"BRIEF:\n{brief.get('full_prompt', '')}\n\n"
            f"OBJETIVO: {brief.get('objective', '')}\n"
            f"TOM: {brief.get('tone', '')}\n\n"
            f"DOSSIÊ:\n{dossier}\n\n"
            "Produza a síntese completa."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=synthesizer_sys), HumanMessage(content=human)],
        )
        return {
            "synthesis_text": str(resp.content).strip(),
            "trace": list(state.get("trace") or []) + ["synthesize"],
        }

    async def node_format_blocks(state: ConversationReplyState) -> dict[str, Any]:
        synthesis = state.get("synthesis_text") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = f"SÍNTESE PARA FORMATAR:\n{synthesis}\n\nDevolve JSON com blocks."
        resp = await chat.ainvoke(
            [SystemMessage(content=formatter_sys), HumanMessage(content=human)],
        )
        blocks = normalize_rich_blocks(parse_rich_blocks_json(str(resp.content)))
        if not blocks and synthesis:
            blocks = normalize_rich_blocks(
                [
                    {"type": "lead", "text": synthesis[:600]},
                    {"type": "paragraph", "text": synthesis[600:1800]},
                ],
            )
        return {
            "rich_blocks": blocks,
            "trace": list(state.get("trace") or []) + ["format_blocks"],
        }

    async def node_finalize(state: ConversationReplyState) -> dict[str, Any]:
        blocks = list(state.get("rich_blocks") or [])
        plain = blocks_to_plain_text(blocks)
        mp = effective_provider(state.get("model_provider"))
        meta: dict[str, Any] = {
            "conversation_format": "rich_blocks",
            "rich_blocks": blocks,
            "intent": "conversation_rich",
            "routed_intent": "conversation_rich",
            "model_provider": mp,
            "conversation_reply": {
                "trace": state.get("trace") or [],
                "block_count": len(blocks),
            },
        }
        return {
            "assistant_text": plain,
            "metadata": meta,
            "trace": list(state.get("trace") or []) + ["finalize"],
        }

    g = StateGraph(ConversationReplyState)
    g.add_node("improve_prompt", node_improve_prompt)
    g.add_node("research", node_research)
    g.add_node("synthesize", node_synthesize)
    g.add_node("format_blocks", node_format_blocks)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "improve_prompt")
    g.add_edge("improve_prompt", "research")
    g.add_edge("research", "synthesize")
    g.add_edge("synthesize", "format_blocks")
    g.add_edge("format_blocks", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


_compiled: Any = None


def get_conversation_reply_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_conversation_reply_graph(settings)
    return _compiled


def reset_conversation_reply_graph_cache() -> None:
    global _compiled
    _compiled = None


_PROGRESS_LABELS: dict[str, str] = {
    "conv_improve_prompt": "A entender e refinar o pedido…",
    "conv_research": "A pesquisar e recolher contexto…",
    "conv_synthesize": "A sintetizar a resposta…",
    "conv_format": "A formatar para o chat…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "improve_prompt": "conv_research",
    "research": "conv_synthesize",
    "synthesize": "conv_format",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"conversation_format": "rich_blocks", "phase": step},
    }


async def run_conversation_reply_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_conversation_reply_graph(settings)
    capped = tail_messages(messages)
    out = await graph.ainvoke(
        {
            "messages": capped,
            "model_provider": model_provider,
            "user_query": last_user_text(capped, 6000),
            "conv_summary": conversation_summary(capped),
            "trace": [],
        },
    )
    text = str(out.get("assistant_text") or "").strip()
    meta = out.get("metadata") if isinstance(out.get("metadata"), dict) else {}
    meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
    text, meta = apply_rich_format_to_reply(text, meta)
    return text, meta


async def run_conversation_reply_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    graph = get_conversation_reply_graph(settings)
    capped = tail_messages(messages)
    state_in: ConversationReplyState = {
        "messages": capped,
        "model_provider": model_provider,
        "user_query": last_user_text(capped, 6000),
        "conv_summary": conversation_summary(capped),
        "trace": [],
    }
    yield _progress_event("conv_improve_prompt")
    merged: dict[str, Any] = dict(state_in)
    try:
        async for chunk in graph.astream(state_in):
            for node_name, patch in chunk.items():
                if isinstance(patch, dict):
                    merged.update(patch)
                next_step = _NEXT_PROGRESS.get(node_name)
                if next_step:
                    yield _progress_event(next_step)
        text = str(merged.get("assistant_text") or "").strip()
        if not text:
            blocks = merged.get("rich_blocks") or []
            if isinstance(blocks, list):
                text = blocks_to_plain_text(blocks)
        meta = merged.get("metadata") if isinstance(merged.get("metadata"), dict) else {}
        if not meta.get("rich_blocks") and merged.get("rich_blocks"):
            meta = {
                **meta,
                "conversation_format": "rich_blocks",
                "rich_blocks": merged.get("rich_blocks"),
                "intent": "conversation_rich",
                "routed_intent": "conversation_rich",
            }
        meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
        text, meta = apply_rich_format_to_reply(text, meta)
        yield {"type": "done", "assistant_text": text, "metadata": meta}
    except Exception as exc:
        _logger.exception("conversation_reply pipeline failed")
        yield {
            "type": "done",
            "assistant_text": (
                f"Não foi possível concluir a resposta formatada. Detalhe: {str(exc)[:300]}"
            ),
            "metadata": {
                "intent": "conversation_rich",
                "error_kind": "conversation_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
