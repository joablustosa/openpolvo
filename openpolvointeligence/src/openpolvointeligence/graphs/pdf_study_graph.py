"""Grafo LangGraph: estudo profissional com PDF (prompt improver → pesquisa → redação → revisão → PDF)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.agent_memory_utils import finalize_reply_metadata
from openpolvointeligence.graphs.message_utils import (
    conversation_summary,
    last_user_text,
    tail_messages,
)
from openpolvointeligence.graphs.models import effective_provider, get_chat_model
from openpolvointeligence.graphs.pdf_render import (
    build_pdf_metadata,
    render_pdf_bytes,
    slugify_filename,
)
from openpolvointeligence.graphs.pdf_study_prompt_logic import (
    format_brief_for_research,
    normalize_enriched_brief,
    parse_enriched_brief_json,
)
from openpolvointeligence.graphs.pdf_study_state import PdfStudyState

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts" / "pdf_study"


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int = 24_000) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def _format_chat_reply(
    brief: dict[str, Any],
    *,
    filename: str,
    has_pdf: bool,
    research_used: bool,
) -> str:
    title = str(brief.get("document_title") or brief.get("objective") or "Estudo profissional")
    sections = brief.get("sections") or []
    sec_preview = ", ".join(str(s) for s in sections[:5])
    if len(sections) > 5:
        sec_preview += "…"
    lines = [
        f"## {title}",
        "",
        "Documento profissional concluído e formatado para entrega em PDF.",
        "",
        f"**Objetivo:** {brief.get('objective', '')}",
        f"**Público-alvo:** {brief.get('audience', '')}",
    ]
    if sec_preview:
        lines.append(f"**Estrutura:** {sec_preview}")
    if research_used:
        lines.append("")
        lines.append(
            "> Pesquisa web consolidada no dossiê antes da redação — factos sem fonte "
            "explícita estão assinalados como premissas no documento."
        )
    lines.extend(
        [
            "",
            "### Entrega",
            "",
        ],
    )
    if has_pdf:
        lines.append(f"- **PDF:** `{filename}` — disponível para download no cartão abaixo.")
    else:
        lines.append(
            "- O PDF excedeu o limite de transferência; o Markdown completo foi preservado "
            "na conversa — peça exportação local se necessário."
        )
    lines.extend(
        [
            "- O conteúdo segue o padrão executivo (resumo, análise, conclusões e revisão técnica).",
            "",
            "Se quiser ajustar tom, secções ou aprofundar um capítulo, descreva a alteração.",
        ],
    )
    return "\n".join(lines)


def build_pdf_study_graph(settings: Settings) -> Any:
    improver_sys = _load_prompt("prompt_improver_system")
    composer_sys = _load_prompt("document_composer_system")
    review_sys = _load_prompt("review_system")

    async def node_improve_prompt(state: PdfStudyState) -> dict[str, Any]:
        raw = state.get("user_query") or ""
        summary = state.get("conv_summary") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = (
            f"PEDIDO DO UTILIZADOR:\n{raw}\n\n"
            f"HISTÓRICO RECENTE:\n{summary}\n\n"
            "Devolve o JSON do brief enriquecido."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=improver_sys), HumanMessage(content=human)],
        )
        brief = parse_enriched_brief_json(str(resp.content))
        brief = normalize_enriched_brief(brief, raw=raw)
        trace = list(state.get("trace") or []) + ["improve_prompt"]
        return {"enriched_brief": brief, "trace": trace}

    async def node_research(state: PdfStudyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        dossier = ""
        trace = list(state.get("trace") or []) + ["research"]
        serp_key = (settings.serpapi_api_key or "").strip()
        queries = brief.get("research_queries") or []
        if not serp_key or not queries:
            note = (
                "Sem pesquisa web automática (falta SERPAPI_API_KEY ou queries). "
                "Redação baseada no brief e conhecimento do modelo; premissas explícitas no texto."
            )
            return {"research_dossier": note, "trace": trace}

        try:
            from openpolvointeligence.graphs.web_research_serpapi import fetch_organic_snippets

            snippets: list[str] = []
            for item in queries[:4]:
                q = str(item).strip()
                if not q:
                    continue
                block = await fetch_organic_snippets(
                    api_key=serp_key,
                    query=q,
                    engine="duckduckgo",
                    max_results=5,
                )
                if block.strip():
                    snippets.append(f"### Query: {q}\n{block.strip()}")
            if snippets:
                dossier = (
                    "## Dossiê de pesquisa (SerpAPI)\n\n"
                    + format_brief_for_research(brief)
                    + "\n\n"
                    + "\n".join(snippets)
                )
            else:
                dossier = "Pesquisa web não devolveu resultados utilizáveis."
        except Exception as exc:
            _logger.warning("pdf_study research failed: %s", exc)
            dossier = (
                f"Pesquisa web indisponível ({exc}). Prosseguir com brief e premissas explícitas."
            )

        return {"research_dossier": _clip(dossier, 18_000), "trace": trace}

    async def node_compose(state: PdfStudyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        dossier = state.get("research_dossier") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        human = (
            f"BRIEF:\n{format_brief_for_research(brief)}\n\n"
            f"PEDIDO EXPANDIDO:\n{brief.get('full_prompt', '')}\n\n"
            f"DOSSIÊ DE PESQUISA:\n{dossier}\n\n"
            "Redija o documento completo em Markdown."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=composer_sys), HumanMessage(content=human)],
        )
        md = str(resp.content).strip()
        trace = list(state.get("trace") or []) + ["compose"]
        return {"document_markdown": md, "trace": trace}

    async def node_review(state: PdfStudyState) -> dict[str, Any]:
        draft = state.get("document_markdown") or ""
        brief = state.get("enriched_brief") or {}
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        human = (
            f"TÍTULO SUGERIDO: {brief.get('document_title', '')}\n\n"
            f"RASCUNHO:\n{draft}\n\n"
            "Devolva a versão final revisada."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=review_sys), HumanMessage(content=human)],
        )
        md = str(resp.content).strip() or draft
        trace = list(state.get("trace") or []) + ["review"]
        return {"reviewed_markdown": md, "trace": trace}

    async def node_render_pdf(state: PdfStudyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        md = state.get("reviewed_markdown") or state.get("document_markdown") or ""
        title = str(brief.get("document_title") or "Estudo profissional")
        filename = slugify_filename(title)
        pdf_bytes = b""
        render_error = ""
        try:
            pdf_bytes = render_pdf_bytes(md, title=title)
        except Exception as exc:
            _logger.warning("pdf render failed: %s", exc)
            render_error = str(exc)[:200]
        trace = list(state.get("trace") or []) + ["render_pdf"]
        return {
            "pdf_bytes": pdf_bytes,
            "pdf_filename": filename,
            "trace": trace,
            "metadata": {"pdf_render_error": render_error} if render_error else {},
        }

    async def node_finalize(state: PdfStudyState) -> dict[str, Any]:
        brief = state.get("enriched_brief") or {}
        md = state.get("reviewed_markdown") or state.get("document_markdown") or ""
        pdf_bytes = state.get("pdf_bytes") or b""
        filename = str(
            state.get("pdf_filename") or slugify_filename(str(brief.get("document_title", "")))
        )
        mp = effective_provider(state.get("model_provider"))
        research_used = bool(
            (state.get("research_dossier") or "").strip()
        ) and "Sem pesquisa" not in (state.get("research_dossier") or "")
        has_pdf = bool(pdf_bytes)
        extra_meta: dict[str, Any] = {
            "pdf_study": {
                "enriched_brief": brief,
                "trace": state.get("trace") or [],
                "research_used": research_used,
            },
            "intent": "estudo_pdf_profissional",
            "routed_intent": "estudo_pdf_profissional",
            "model_provider": mp,
        }
        prior = state.get("metadata") or {}
        if isinstance(prior, dict) and prior.get("pdf_render_error"):
            extra_meta["pdf_render_error"] = prior["pdf_render_error"]
        meta = build_pdf_metadata(
            pdf_bytes,
            filename=filename,
            markdown_text=md,
            extra=extra_meta,
        )
        assistant_text = _format_chat_reply(
            brief,
            filename=filename,
            has_pdf=has_pdf,
            research_used=research_used,
        )
        trace = list(state.get("trace") or []) + ["finalize"]
        return {
            "assistant_text": assistant_text,
            "metadata": meta,
            "trace": trace,
        }

    g = StateGraph(PdfStudyState)
    g.add_node("improve_prompt", node_improve_prompt)
    g.add_node("research", node_research)
    g.add_node("compose", node_compose)
    g.add_node("review", node_review)
    g.add_node("render_pdf", node_render_pdf)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "improve_prompt")
    g.add_edge("improve_prompt", "research")
    g.add_edge("research", "compose")
    g.add_edge("compose", "review")
    g.add_edge("review", "render_pdf")
    g.add_edge("render_pdf", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


_compiled: Any = None


def get_pdf_study_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_pdf_study_graph(settings)
    return _compiled


def reset_pdf_study_graph_cache() -> None:
    global _compiled
    _compiled = None


_PROGRESS_LABELS: dict[str, str] = {
    "pdf_improve_prompt": "A refinar o pedido e planear o documento…",
    "pdf_research": "A pesquisar fontes e consolidar evidências…",
    "pdf_compose": "A redigir o documento profissional…",
    "pdf_review": "Revisão técnica e acabamento editorial…",
    "pdf_render": "A gerar o ficheiro PDF…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "improve_prompt": "pdf_research",
    "research": "pdf_compose",
    "compose": "pdf_review",
    "review": "pdf_render",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"document_kind": "pdf_study_report", "phase": step},
    }


async def run_pdf_study_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_pdf_study_graph(settings)
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
    return text, meta


async def run_pdf_study_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream com eventos progress por fase + done com PDF em metadata."""
    graph = get_pdf_study_graph(settings)
    capped = tail_messages(messages)
    state_in: PdfStudyState = {
        "messages": capped,
        "model_provider": model_provider,
        "user_query": last_user_text(capped, 6000),
        "conv_summary": conversation_summary(capped),
        "trace": [],
    }
    yield _progress_event("pdf_improve_prompt")
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
        meta = merged.get("metadata") if isinstance(merged.get("metadata"), dict) else {}
        meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
        yield {"type": "done", "assistant_text": text, "metadata": meta}
    except Exception as exc:
        _logger.exception("pdf_study pipeline failed")
        yield {
            "type": "done",
            "assistant_text": (
                f"Não foi possível concluir o estudo em PDF. Detalhe: {str(exc)[:300]}"
            ),
            "metadata": {
                "intent": "estudo_pdf_profissional",
                "error_kind": "pdf_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
