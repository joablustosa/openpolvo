"""Sub-grafo LangGraph por URL: fetch HTTP (trafilatura) → agente LLM especialista em extração."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.web_research.web_page_fetch import fetch_url_plaintext

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "web_research"


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
    sys_specialist = _load_prompt("site_scrape_specialist_system")
    timeout_s = float(settings.web_fetch_timeout_s or 18.0)
    max_bytes = int(settings.web_fetch_max_response_bytes or 600_000)
    max_chars = int(settings.web_fetch_max_text_chars)
    use_tf = bool(settings.web_fetch_use_trafilatura)

    async def node_fetch(state: SiteResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        url = str(state.get("url", "")).strip()
        raw = await fetch_url_plaintext(
            url,
            timeout_s=timeout_s,
            max_bytes=max_bytes,
            max_chars=max_chars,
            use_trafilatura=use_tf,
        )
        mode = "trafilatura" if use_tf else "regex"
        trace.append(f"fetch:{mode}:{url[:60]}")
        return {"raw_text": raw, "trace": trace}

    async def node_scrape_specialist(state: SiteResearchState) -> dict[str, Any]:
        """LLM: interpreta o texto principal (pós-trafilatura) alinhado ao pedido do utilizador."""
        trace = list(state.get("trace") or [])
        url = str(state.get("url", "")).strip()
        uq = str(state.get("user_query", "")).strip()
        raw = str(state.get("raw_text", "")).strip()
        clip = raw[:16_000] if len(raw) > 16_000 else raw
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        user = (
            f"URL da página: {url}\n\n"
            f"Pedido global do utilizador (pesquisa web):\n{uq[:3000]}\n\n"
            f"--- Texto principal extraído da página (pipeline trafilatura + fetch seguro) ---\n"
            f"{clip}"
        )
        try:
            resp = await chat.ainvoke(
                [SystemMessage(content=sys_specialist), HumanMessage(content=user)],
            )
            summary = str(resp.content or "").strip()
        except Exception as exc:
            _logger.warning("scrape_specialist fail %s: %s", url[:80], exc)
            summary = f"_(Agente de extração web falhou: {exc})_"
        trace.append("scrape_specialist")
        return {"site_summary": summary, "trace": trace}

    g = StateGraph(SiteResearchState)
    g.add_node("fetch", node_fetch)
    g.add_node("scrape_specialist", node_scrape_specialist)
    g.add_edge(START, "fetch")
    g.add_edge("fetch", "scrape_specialist")
    g.add_edge("scrape_specialist", END)
    return g.compile()
