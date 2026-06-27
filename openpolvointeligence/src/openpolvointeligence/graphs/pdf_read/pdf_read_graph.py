"""Grafo LangGraph: leitura de PDFs anexados (extração → OCR → estrutura → Q&A).

Distinto do ``pdf_study`` (que *gera* PDFs): este lê PDFs de entrada e responde
ao utilizador com base apenas no conteúdo extraído. Camada determinística primeiro
(PyMuPDF/pdfplumber/OCR, zero-token), LLM apenas no nó de síntese final.
"""

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
from openpolvointeligence.graphs.pdf_read.pdf_read_extract_logic import (
    decode_attachment,
    extract_pdf_content_full,
)
from openpolvointeligence.graphs.pdf_read.pdf_read_ocr_logic import ocr_scanned_pages
from openpolvointeligence.graphs.pdf_read.pdf_read_routing import pdf_attachments
from openpolvointeligence.graphs.pdf_read.pdf_read_state import PdfReadState

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "pdf_read"

# Budget de contexto extraído enviado ao LLM e guardado para turnos seguintes.
_DOC_BUDGET_CHARS = 12_000


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def _extract_documents(attachments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Extrai conteúdo de cada PDF anexado e aplica OCR às páginas escaneadas."""
    docs: list[dict[str, Any]] = []
    ocr_notes: list[str] = []
    for att in pdf_attachments(attachments):
        filename = str(att.get("name") or "documento.pdf")
        pdf_bytes = decode_attachment(att)
        if not pdf_bytes:
            docs.append({"filename": filename, "error": "Anexo ilegível (base64 inválido).", "pages": []})
            continue
        content = extract_pdf_content_full(pdf_bytes, filename=filename)
        pages = content.get("pages") or []
        ocr_results, notes = ocr_scanned_pages(pdf_bytes, pages)
        for page in pages:
            ocr_text = ocr_results.get(int(page["page"]))
            if ocr_text:
                page["text"] = ocr_text
                page["char_count"] = len(ocr_text)
                page["ocr"] = True
        ocr_notes.extend(notes)
        docs.append(
            {
                "filename": filename,
                "title": content.get("title") or filename,
                "page_count": content.get("page_count") or len(pages),
                "pages": pages,
                "tables": content.get("tables") or [],
                "images": content.get("images") or [],
                "ocr_used": bool(ocr_results),
                "extractor": content.get("extractor"),
                "error": content.get("error") or "",
            }
        )
    return docs, ocr_notes


def _build_markdown(docs: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for doc in docs:
        title = doc.get("title") or doc.get("filename")
        parts.append(f"# Documento: {title} ({doc.get('page_count', 0)} páginas)")
        if doc.get("error"):
            parts.append(f"> Aviso de extração: {doc['error']}")
        for page in doc.get("pages") or []:
            text = str(page.get("text") or "").strip()
            flag = " (OCR)" if page.get("ocr") else ""
            parts.append(f"## Página {page.get('page')}{flag}")
            parts.append(text or "_(sem texto extraível nesta página)_")
        for table in doc.get("tables") or []:
            parts.append(f"### Tabela (página {table.get('page')})")
            parts.append(str(table.get("markdown") or ""))
    return "\n\n".join(p for p in parts if p).strip()


def build_pdf_read_graph(settings: Settings) -> Any:
    answer_sys = _load_prompt("synthesize_answer")

    async def node_extract(state: PdfReadState) -> dict[str, Any]:
        attachments = state.get("attachments") or []
        docs, ocr_notes = _extract_documents(attachments)
        trace = list(state.get("trace") or []) + ["extract"]
        return {"metadata": {"_docs": docs}, "ocr_notes": ocr_notes, "trace": trace}

    def node_structure(state: PdfReadState) -> dict[str, Any]:
        prior = state.get("metadata") or {}
        docs = prior.get("_docs") if isinstance(prior, dict) else []
        md = _build_markdown(docs or [])
        trace = list(state.get("trace") or []) + ["structure"]
        return {"document_markdown": md, "trace": trace}

    async def node_answer(state: PdfReadState) -> dict[str, Any]:
        query = (state.get("user_query") or "").strip()
        summary = state.get("conv_summary") or ""
        md = state.get("document_markdown") or ""
        ocr_notes = state.get("ocr_notes") or []
        trace = list(state.get("trace") or []) + ["answer"]
        if not md:
            return {
                "assistant_text": (
                    "Não consegui extrair conteúdo do PDF anexado. Verifique se o ficheiro "
                    "é um PDF válido e não está protegido por palavra-passe."
                ),
                "trace": trace,
            }
        notes_block = ("\n\nNOTAS DE OCR:\n- " + "\n- ".join(ocr_notes)) if ocr_notes else ""
        human = (
            f"PERGUNTA DO UTILIZADOR:\n{query or '(nenhuma pergunta explícita — apenas o PDF foi anexado)'}\n\n"
            f"HISTÓRICO RECENTE:\n{summary}\n\n"
            f"CONTEÚDO EXTRAÍDO DO(S) PDF(S):\n{_clip(md, _DOC_BUDGET_CHARS)}"
            f"{notes_block}"
        )
        try:
            chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
            resp = await chat.ainvoke(
                [SystemMessage(content=answer_sys), HumanMessage(content=human)],
            )
            text = str(resp.content).strip()
        except Exception as exc:  # noqa: BLE001
            _logger.warning("pdf_read answer failed: %s", exc)
            text = (
                "Extraí o conteúdo do PDF, mas não foi possível gerar a resposta com o modelo "
                f"selecionado. Detalhe: {str(exc)[:200]}"
            )
        return {"assistant_text": text, "trace": trace}

    def node_finalize(state: PdfReadState) -> dict[str, Any]:
        prior = state.get("metadata") or {}
        docs = prior.get("_docs") if isinstance(prior, dict) else []
        docs = docs or []
        md = state.get("document_markdown") or ""
        mp = effective_provider(state.get("model_provider"))
        total_pages = sum(int(d.get("page_count") or 0) for d in docs)
        total_tables = sum(len(d.get("tables") or []) for d in docs)
        ocr_used = any(d.get("ocr_used") for d in docs)
        doc_summaries = [
            {
                "filename": d.get("filename"),
                "pages": d.get("page_count") or 0,
                "tables_count": len(d.get("tables") or []),
                "images_count": len(d.get("images") or []),
                "ocr_used": bool(d.get("ocr_used")),
                "extractor": d.get("extractor"),
                "error": d.get("error") or "",
            }
            for d in docs
        ]
        meta: dict[str, Any] = {
            "document_kind": "pdf_read_result",
            "intent": "leitura_pdf",
            "routed_intent": "leitura_pdf",
            "model_provider": mp,
            "pdf_read": {
                "documents": doc_summaries,
                "pages": total_pages,
                "tables_count": total_tables,
                "ocr_used": ocr_used,
                "filenames": [d.get("filename") for d in docs],
                "document_markdown": _clip(md, _DOC_BUDGET_CHARS),
                "ocr_notes": state.get("ocr_notes") or [],
                "trace": state.get("trace") or [],
            },
        }
        trace = list(state.get("trace") or []) + ["finalize"]
        return {"metadata": meta, "trace": trace}

    g = StateGraph(PdfReadState)
    g.add_node("extract", node_extract)
    g.add_node("structure", node_structure)
    g.add_node("answer", node_answer)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "extract")
    g.add_edge("extract", "structure")
    g.add_edge("structure", "answer")
    g.add_edge("answer", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


_compiled: Any = None


def get_pdf_read_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_pdf_read_graph(settings)
    return _compiled


def reset_pdf_read_graph_cache() -> None:
    global _compiled
    _compiled = None


def _initial_state(
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
) -> PdfReadState:
    capped = tail_messages(messages)
    return {
        "messages": capped,
        "model_provider": model_provider,
        "user_query": last_user_text(capped, 6000),
        "conv_summary": conversation_summary(capped),
        "attachments": attachments or [],
        "trace": [],
    }


async def run_pdf_read_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_pdf_read_graph(settings)
    out = await graph.ainvoke(_initial_state(messages, model_provider, attachments))
    text = str(out.get("assistant_text") or "").strip()
    meta = out.get("metadata") if isinstance(out.get("metadata"), dict) else {}
    meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
    return text, meta


_PROGRESS_LABELS: dict[str, str] = {
    "pdf_read_extract": "A extrair texto, tabelas e imagens do PDF…",
    "pdf_read_ocr": "A aplicar OCR às páginas escaneadas…",
    "pdf_read_answer": "A analisar o documento e preparar a resposta…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "extract": "pdf_read_ocr",
    "structure": "pdf_read_answer",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"document_kind": "pdf_read_result", "phase": step},
    }


async def run_pdf_read_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    graph = get_pdf_read_graph(settings)
    state_in = _initial_state(messages, model_provider, attachments)
    yield _progress_event("pdf_read_extract")
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
        _logger.exception("pdf_read pipeline failed")
        yield {
            "type": "done",
            "assistant_text": (
                f"Não foi possível ler o PDF anexado. Detalhe: {str(exc)[:300]}"
            ),
            "metadata": {
                "intent": "leitura_pdf",
                "error_kind": "pdf_read_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
