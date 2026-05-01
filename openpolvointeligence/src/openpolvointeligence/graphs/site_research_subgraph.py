"""Sub-grafo LangGraph por URL: fetch HTTP → resumo LLM (um site)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.web_page_fetch import fetch_url_plaintext

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts" / "web_research"


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


class SiteResearchState(TypedDict, total=False):
    model_provider: str | None
    user_query: str
    url: str
    raw_text: str
    site_summary: str
    trace: list[str]


def build_site_research_graph(settings: Settings) -> Any:
    sys_site = _load_prompt("site_summarizer_system")
    timeout_s = float(settings.web_fetch_timeout_s or 18.0)
    max_bytes = int(settings.web_fetch_max_response_bytes or 600_000)
    max_chars = int(settings.web_fetch_max_text_chars)

    async def node_fetch(state: SiteResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        url = str(state.get("url", "")).strip()
        raw = await fetch_url_plaintext(
            url,
            timeout_s=timeout_s,
            max_bytes=max_bytes,
            max_chars=max_chars,
        )
        trace.append(f"fetch:{url[:60]}")
        return {"raw_text": raw, "trace": trace}

    async def node_summarize(state: SiteResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        url = str(state.get("url", "")).strip()
        uq = str(state.get("user_query", "")).strip()
        raw = str(state.get("raw_text", "")).strip()
        clip = raw[:14_000] if len(raw) > 14_000 else raw
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        user = f"URL da página: {url}\n\nPedido global do utilizador:\n{uq[:2000]}\n\nTexto da página:\n{clip}"
        try:
            resp = await chat.ainvoke(
                [SystemMessage(content=sys_site), HumanMessage(content=user)],
            )
            summary = str(resp.content or "").strip()
        except Exception as exc:
            _logger.warning("site summarize fail %s: %s", url[:80], exc)
            summary = f"_(Resumo automático falhou: {exc})_"
        trace.append("summarize")
        return {"site_summary": summary, "trace": trace}

    g = StateGraph(SiteResearchState)
    g.add_node("fetch", node_fetch)
    g.add_node("summarize", node_summarize)
    g.add_edge(START, "fetch")
    g.add_edge("fetch", "summarize")
    g.add_edge("summarize", END)
    return g.compile()
