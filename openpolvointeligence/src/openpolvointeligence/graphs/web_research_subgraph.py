"""Sub-grafo LangGraph: pesquisa web multi-etapas (planeamento → SerpAPI → síntese → crítica → refinamento → entrega)."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.message_utils import last_user_text
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.site_research_subgraph import build_site_research_graph
from openpolvointeligence.graphs.web_research_serpapi import fetch_organic_snippets, parse_plan_json
from openpolvointeligence.graphs.web_url_extract import pick_urls_for_deep_dive

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts" / "web_research"
_MAX_SNIPPET_CHARS = 14_000


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int = _MAX_SNIPPET_CHARS) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


class WebResearchState(TypedDict, total=False):
    model_provider: str | None
    user_query: str
    conv_summary: str
    queries: list[dict[str, Any]]
    snippets: list[str]
    deep_urls: list[str]
    site_blocks: list[str]
    unified_cross_site: str
    dossier: str
    critic: dict[str, Any]
    refine_round: int
    final_text: str
    trace: list[str]


def _parse_critic_json(raw: str) -> dict[str, Any]:
    s = raw.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = "\n".join(lines[1:-1]) if lines[-1].strip().startswith("```") else "\n".join(lines[1:])
            s = inner.strip()
    try:
        d = json.loads(s)
    except json.JSONDecodeError:
        return {"satisfied": True, "reason": "parse_error", "follow_up_queries": []}
    if not isinstance(d, dict):
        return {"satisfied": True, "reason": "invalid", "follow_up_queries": []}
    fq = d.get("follow_up_queries")
    if not isinstance(fq, list):
        fq = []
    clean: list[dict[str, str]] = []
    for item in fq[:2]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("q", "")).strip()
        eng = str(item.get("engine", "duckduckgo")).strip().lower()
        if eng not in ("duckduckgo", "google"):
            eng = "duckduckgo"
        if q:
            clean.append({"q": q, "engine": eng})
    return {
        "satisfied": bool(d.get("satisfied", True)),
        "reason": str(d.get("reason", "")).strip(),
        "follow_up_queries": clean,
    }


def build_web_research_graph(settings: Settings) -> Any:
    planner_sys = _load_prompt("planner_system")
    synth_sys = _load_prompt("synthesizer_system")
    critic_sys = _load_prompt("critic_system")
    final_sys = _load_prompt("finalist_system")
    unifier_sys = _load_prompt("cross_site_unifier_system")
    api_key = (settings.serpapi_api_key or "").strip()
    kl = (settings.serpapi_ddg_kl or "").strip() or None
    ddg_safe = int(settings.serpapi_ddg_safe or 0)

    async def node_plan(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        uq = str(state.get("user_query", "")).strip()
        cs = str(state.get("conv_summary", "")).strip()
        user = f"user_query:\n{uq}\n\nconv_summary:\n{cs}"
        resp = await chat.ainvoke(
            [SystemMessage(content=planner_sys), HumanMessage(content=user)],
        )
        raw = str(resp.content or "").strip()
        plan = parse_plan_json(raw)
        queries = plan.get("queries")
        if not isinstance(queries, list) or len(queries) == 0:
            queries = [{"q": uq[:400] or "pesquisa", "engine": "duckduckgo"}]
        norm: list[dict[str, Any]] = []
        for item in queries[:4]:
            if not isinstance(item, dict):
                continue
            q = str(item.get("q", "")).strip()
            eng = str(item.get("engine", "duckduckgo")).strip().lower()
            if eng not in ("duckduckgo", "google"):
                eng = "duckduckgo"
            if q:
                norm.append({"q": q, "engine": eng})
        if not norm:
            norm = [{"q": uq[:400] or "pesquisa", "engine": "duckduckgo"}]
        trace.append(f"plan:{len(norm)} queries")
        return {"queries": norm, "refine_round": int(state.get("refine_round") or 0), "trace": trace}

    async def node_research(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        queries = state.get("queries") or []
        prev = list(state.get("snippets") or [])
        if not api_key:
            raise RuntimeError("SERPAPI_API_KEY vazia")
        blocks: list[str] = []
        for item in queries:
            q = str(item.get("q", "")).strip()
            eng = str(item.get("engine", "duckduckgo")).strip().lower()
            if not q:
                continue
            try:
                block = await fetch_organic_snippets(
                    api_key=api_key,
                    query=q,
                    engine=eng,
                    kl=kl,
                    ddg_safe=ddg_safe,
                )
                blocks.append(block)
            except Exception as exc:
                _logger.warning("serpapi fail q=%s: %s", q[:80], exc)
                blocks.append(f"### Erro SerpAPI ({eng}) — `{q[:120]}`\n_{exc}_\n")
        trace.append(f"research:{len(blocks)} blocks round={state.get('refine_round', 0)}")
        return {"snippets": prev + blocks, "trace": trace}

    async def node_deep_sites(state: WebResearchState) -> dict[str, Any]:
        """Sub-grafo por URL (fetch + resumo) em paralelo, depois unificador multi-site."""
        trace = list(state.get("trace") or [])
        snippets = state.get("snippets") or []
        max_u = max(1, min(8, int(settings.web_research_max_deep_urls or 4)))
        urls = pick_urls_for_deep_dive(snippets, max_urls=max_u, max_per_host=2)
        if not urls:
            trace.append("deep_sites:skip")
            return {
                "deep_urls": [],
                "site_blocks": [],
                "unified_cross_site": "",
                "trace": trace,
            }
        site_g = build_site_research_graph(settings)
        uq = str(state.get("user_query", "")).strip()
        mp = state.get("model_provider")
        sem = asyncio.Semaphore(3)

        async def run_one(u: str) -> str:
            try:
                out = await site_g.ainvoke(
                    {
                        "url": u,
                        "user_query": uq,
                        "model_provider": mp,
                        "trace": [],
                    },
                )
                sm = str(out.get("site_summary") or "").strip()
                return f"### Site: `{u}`\n\n{sm}" if sm else ""
            except Exception as exc:
                _logger.warning("site subgraph fail %s: %s", u[:80], exc)
                return f"### Site: `{u}`\n\n_(Erro no sub-grafo: {exc})_"

        async def bounded(u: str) -> str:
            async with sem:
                return await run_one(u)

        site_blocks = [b for b in await asyncio.gather(*[bounded(u) for u in urls]) if b]
        trace.append(f"deep_sites:{len(urls)} urls")

        unified = ""
        if site_blocks:
            chat = get_chat_model(settings, mp, json_mode=False)
            pack = "\n\n---\n\n".join(site_blocks)
            pack = pack[:18_000] if len(pack) > 18_000 else pack
            user_u = f"## Pedido\n{uq}\n\n## Resumos por site\n{pack}"
            try:
                resp = await chat.ainvoke(
                    [SystemMessage(content=unifier_sys), HumanMessage(content=user_u)],
                )
                unified = str(resp.content or "").strip()
            except Exception as exc:
                _logger.warning("cross_site unifier: %s", exc)
                unified = ""
        trace.append("unify_cross_site" if unified else "unify:empty")
        return {
            "deep_urls": urls,
            "site_blocks": site_blocks,
            "unified_cross_site": unified,
            "trace": trace,
        }

    async def node_synthesize(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        bundle = "\n\n---\n\n".join(state.get("snippets") or [])
        bundle = _clip(bundle)
        uq = str(state.get("user_query", "")).strip()
        extra_parts: list[str] = []
        uni = str(state.get("unified_cross_site") or "").strip()
        if uni:
            extra_parts.append("## Consolidação multi-site (grafo unificador)\n" + _clip(uni, 10_000))
        sblocks = state.get("site_blocks") or []
        if isinstance(sblocks, list) and sblocks:
            joined = "\n\n---\n\n".join(str(x) for x in sblocks if x)
            extra_parts.append("## Resumo por página (sub-grafos por URL)\n" + _clip(joined, 12_000))
        extra = ""
        if extra_parts:
            extra = "\n\n".join(extra_parts) + "\n\n"
        user = f"## Pedido do utilizador\n{uq}\n\n{extra}## Excertos SerpAPI\n{bundle}"
        resp = await chat.ainvoke(
            [SystemMessage(content=synth_sys), HumanMessage(content=user)],
        )
        dossier = str(resp.content or "").strip()
        trace.append("synthesize")
        return {"dossier": dossier, "trace": trace}

    async def node_critic(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        uq = str(state.get("user_query", "")).strip()
        dossier = str(state.get("dossier", "")).strip()
        user = f"## Pedido\n{uq}\n\n## Dossier\n{dossier[:12000]}"
        resp = await chat.ainvoke(
            [SystemMessage(content=critic_sys), HumanMessage(content=user)],
        )
        critic = _parse_critic_json(str(resp.content or ""))
        trace.append(f"critic:satisfied={critic.get('satisfied')}")
        return {"critic": critic, "trace": trace}

    async def node_finalize(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        uq = str(state.get("user_query", "")).strip()
        dossier = str(state.get("dossier", "")).strip()
        bundle = _clip("\n\n---\n\n".join(state.get("snippets") or []))
        uni = str(state.get("unified_cross_site") or "").strip()
        uni_blk = (
            f"\n\n## Consolidação multi-site\n{_clip(uni, 8000)}\n"
            if uni
            else ""
        )
        user = (
            f"## Pedido do utilizador\n{uq}\n\n## Dossier de trabalho (interno)\n{dossier}"
            f"{uni_blk}\n\n## Excertos brutos (referência de URLs)\n{bundle}"
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=final_sys), HumanMessage(content=user)],
        )
        final_text = str(resp.content or "").strip()
        trace.append("finalize")
        return {"final_text": final_text, "trace": trace}

    def route_after_critic(s: WebResearchState) -> Literal["refine", "finalize"]:
        rnd = int(s.get("refine_round") or 0)
        if rnd >= 1:
            return "finalize"
        c = s.get("critic") or {}
        if bool(c.get("satisfied")):
            return "finalize"
        fq = c.get("follow_up_queries") or []
        if isinstance(fq, list) and len(fq) > 0:
            return "refine"
        return "finalize"

    async def node_prepare_refine(state: WebResearchState) -> dict[str, Any]:
        trace = list(state.get("trace") or [])
        c = state.get("critic") or {}
        fq = c.get("follow_up_queries") or []
        if not isinstance(fq, list):
            fq = []
        trace.append("refine:scheduled")
        return {
            "queries": list(fq)[:2],
            "refine_round": int(state.get("refine_round") or 0) + 1,
            "trace": trace,
        }

    g = StateGraph(WebResearchState)
    g.add_node("plan", node_plan)
    g.add_node("research", node_research)
    g.add_node("deep_sites", node_deep_sites)
    g.add_node("synthesize", node_synthesize)
    g.add_node("critic", node_critic)
    g.add_node("prepare_refine", node_prepare_refine)
    g.add_node("finalize", node_finalize)

    g.add_edge(START, "plan")
    g.add_edge("plan", "research")
    g.add_edge("research", "deep_sites")
    g.add_edge("deep_sites", "synthesize")
    g.add_edge("synthesize", "critic")
    g.add_conditional_edges(
        "critic",
        route_after_critic,
        {"refine": "prepare_refine", "finalize": "finalize"},
    )
    g.add_edge("prepare_refine", "research")
    g.add_edge("finalize", END)
    return g.compile()


async def run_web_research_pipeline(
    settings: Settings,
    model_provider: str | None,
    messages: list[dict[str, Any]],
    conv_summary: str,
) -> tuple[str, dict[str, Any]]:
    """Executa o sub-grafo e devolve (texto ao utilizador, metadata extra)."""
    uq = last_user_text(messages, 6000)
    graph = build_web_research_graph(settings)
    init: WebResearchState = {
        "model_provider": model_provider,
        "user_query": uq,
        "conv_summary": (conv_summary or "").strip(),
        "snippets": [],
        "deep_urls": [],
        "site_blocks": [],
        "unified_cross_site": "",
        "refine_round": 0,
        "trace": [],
    }
    out = await graph.ainvoke(init)
    text = str(out.get("final_text", "")).strip()
    if not text:
        text = (
            "A pesquisa web multi-etapas não produziu texto final. "
            "Verifique `SERPAPI_API_KEY` e quotas SerpAPI."
        )
    meta_extra: dict[str, Any] = {
        "web_research_pipeline": True,
        "web_research_trace": out.get("trace") or [],
        "web_research_deep_urls": list(out.get("deep_urls") or []),
        "web_research_site_blocks_count": len(out.get("site_blocks") or []),
    }
    return text, meta_extra
