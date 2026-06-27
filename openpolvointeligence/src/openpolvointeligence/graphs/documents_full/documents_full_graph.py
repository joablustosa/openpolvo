"""Grafo LangGraph unificado: ler/interpretar/criar/editar documentos Word (.doc/.docx)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.agent_memory_utils import finalize_reply_metadata
from openpolvointeligence.graphs.documents_full.documents_build_logic import (
    DocxBuildError,
    apply_edit_ops,
    build_docx_bytes,
    build_docx_metadata,
    ensure_docx_filename,
)
from openpolvointeligence.graphs.documents_full.documents_full_routing import (
    classify_doc_intent,
    word_attachments,
)
from openpolvointeligence.graphs.documents_full.documents_full_state import DocumentsFullState
from openpolvointeligence.graphs.documents_full.documents_read_logic import (
    decode_attachment,
    digest_to_markdown,
    read_document_digest,
)
from openpolvointeligence.graphs.documents_full.documents_spec_logic import (
    normalize_document_spec,
    normalize_edit_plan,
    parse_json_block,
    validate_document_spec,
    validate_edit_plan,
)
from openpolvointeligence.graphs.message_utils import (
    conversation_summary,
    last_user_text,
    tail_messages,
)
from openpolvointeligence.graphs.models import effective_provider, get_chat_model

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "documents_full"

_DIGEST_BUDGET_CHARS = 12_000


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def _read_digests(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    digests: list[dict[str, Any]] = []
    for att in word_attachments(attachments):
        filename = str(att.get("name") or "documento.docx")
        data = decode_attachment(att)
        if not data:
            digests.append(
                {
                    "filename": filename,
                    "kind": "?",
                    "markdown": "",
                    "error": "Anexo ilegível (base64 inválido).",
                }
            )
            continue
        digest = read_document_digest(
            data, filename=filename, mime_type=str(att.get("mime_type") or "")
        )
        digest["_raw"] = data
        digests.append(digest)
    return digests


def _digests_markdown(digests: list[dict[str, Any]]) -> str:
    return "\n\n".join(digest_to_markdown(d) for d in digests).strip()


def _digest_stats(digests: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "files": len(digests),
        "headings": sum(int(d.get("headings") or 0) for d in digests),
        "paragraphs": sum(int(d.get("paragraphs") or 0) for d in digests),
        "tables": sum(int(d.get("tables") or 0) for d in digests),
    }


def build_documents_full_graph(settings: Settings) -> Any:
    answer_sys = _load_prompt("answer_query")
    design_sys = _load_prompt("design_document")
    edit_sys = _load_prompt("edit_document")

    def node_parse(state: DocumentsFullState) -> dict[str, Any]:
        attachments = state.get("attachments") or []
        digests = _read_digests(attachments)
        mode = classify_doc_intent(state.get("user_query") or "", has_attachment=bool(digests))
        trace = list(state.get("trace") or []) + [f"parse:{mode}"]
        return {"mode": mode, "metadata": {"_digests": digests}, "trace": trace}

    def _route(state: DocumentsFullState) -> str:
        return "answer" if state.get("mode") == "read" else "spec"

    async def node_answer(state: DocumentsFullState) -> dict[str, Any]:
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        md = _digests_markdown(digests or [])
        query = (state.get("user_query") or "").strip()
        summary = state.get("conv_summary") or ""
        trace = list(state.get("trace") or []) + ["answer"]
        if not md:
            return {
                "assistant_text": (
                    "Não consegui ler o documento anexado. Verifique se o ficheiro é um .docx ou "
                    ".doc válido."
                ),
                "trace": trace,
            }
        human = (
            f"PERGUNTA DO UTILIZADOR:\n{query or '(sem pergunta explícita — apenas o documento foi anexado)'}\n\n"
            f"HISTÓRICO RECENTE:\n{summary}\n\n"
            f"CONTEÚDO DO(S) DOCUMENTO(S):\n{_clip(md, _DIGEST_BUDGET_CHARS)}"
        )
        try:
            chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
            resp = await chat.ainvoke(
                [SystemMessage(content=answer_sys), HumanMessage(content=human)]
            )
            text = str(resp.content).strip()
        except Exception as exc:  # noqa: BLE001
            _logger.warning("documents_full answer failed: %s", exc)
            text = (
                "Li o documento, mas não foi possível gerar a análise com o modelo selecionado. "
                f"Detalhe: {str(exc)[:200]}"
            )
        return {"assistant_text": text, "trace": trace}

    async def node_spec(state: DocumentsFullState) -> dict[str, Any]:
        mode = state.get("mode") or "create"
        query = (state.get("user_query") or "").strip()
        summary = state.get("conv_summary") or ""
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        trace = list(state.get("trace") or []) + ["spec"]
        if mode == "edit":
            md = _digests_markdown(digests or [])
            sys = edit_sys
            human = (
                f"PEDIDO DE EDIÇÃO:\n{query}\n\nHISTÓRICO:\n{summary}\n\n"
                f"DOCUMENTO ATUAL (digest):\n{_clip(md, _DIGEST_BUDGET_CHARS)}"
            )
        else:
            sys = design_sys
            human = f"PEDIDO:\n{query}\n\nHISTÓRICO:\n{summary}"
        try:
            chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
            resp = await chat.ainvoke([SystemMessage(content=sys), HumanMessage(content=human)])
            raw = str(resp.content)
        except Exception as exc:  # noqa: BLE001
            _logger.warning("documents_full spec failed: %s", exc)
            return {"document_spec": {"_error": f"spec_failed: {str(exc)[:200]}"}, "trace": trace}
        parsed = parse_json_block(raw)
        if mode == "edit":
            plan = normalize_edit_plan(parsed)
            errs = validate_edit_plan(plan)
            return {
                "document_spec": {"_kind": "edit", "plan": plan, "_errors": errs},
                "trace": trace,
            }
        spec = normalize_document_spec(parsed)
        errs = validate_document_spec(spec)
        return {"document_spec": {"_kind": "create", "spec": spec, "_errors": errs}, "trace": trace}

    def node_build(state: DocumentsFullState) -> dict[str, Any]:
        wrapper = state.get("document_spec") or {}
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        trace = list(state.get("trace") or []) + ["build"]
        errs = wrapper.get("_errors") or []
        if wrapper.get("_error") or errs:
            detail = wrapper.get("_error") or "; ".join(errs)
            return {
                "assistant_text": f"Não consegui montar o documento: {detail}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        try:
            if wrapper.get("_kind") == "edit":
                source = next((d for d in (digests or []) if d.get("_raw")), None)
                src_bytes = source.get("_raw") if source else None
                kind = str(source.get("kind") if source else "")
                if not src_bytes or kind != "docx":
                    return {
                        "assistant_text": (
                            "A edição in-place requer um ficheiro .docx. "
                            "Para .doc legado, converta para .docx ou peça para criar um novo documento."
                        ),
                        "metadata": {"_build_failed": True},
                        "trace": trace,
                    }
                docx_bytes = apply_edit_ops(src_bytes, wrapper["plan"])
                base_name = digests[0].get("filename") if digests else "documento-editado.docx"
                filename = ensure_docx_filename(str(base_name))
                spec_summary = {"mode": "edit", "ops": len(wrapper["plan"].get("ops") or [])}
            else:
                spec = wrapper["spec"]
                docx_bytes = build_docx_bytes(spec)
                filename = ensure_docx_filename(spec.get("filename") or "documento.docx")
                spec_summary = {
                    "mode": "create",
                    "blocks": len(spec.get("blocks") or []),
                    "filename": filename,
                }
        except DocxBuildError as exc:
            return {
                "assistant_text": f"Geração de .docx indisponível: {exc}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        except Exception as exc:  # noqa: BLE001
            _logger.exception("documents build failed")
            return {
                "assistant_text": f"Falha ao gerar o ficheiro .docx: {str(exc)[:200]}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        return {
            "docx_bytes": docx_bytes,
            "docx_filename": filename,
            "metadata": {"_spec_summary": spec_summary},
            "trace": trace,
        }

    def node_finalize(state: DocumentsFullState) -> dict[str, Any]:
        mode = state.get("mode") or "read"
        mp = effective_provider(state.get("model_provider"))
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        trace = list(state.get("trace") or []) + ["finalize"]
        query = (state.get("user_query") or "").lower()

        if mode == "read":
            stats = _digest_stats(digests or [])
            meta: dict[str, Any] = {
                "document_kind": "doc_read_result",
                "intent": "criacao_leitura_word",
                "routed_intent": "criacao_leitura_word",
                "model_provider": mp,
                "documents_full": {
                    "mode": "read",
                    "files": stats["files"],
                    "headings": stats["headings"],
                    "paragraphs": stats["paragraphs"],
                    "tables": stats["tables"],
                    "filenames": [d.get("filename") for d in (digests or [])],
                    "trace": state.get("trace") or [],
                },
            }
            return {"metadata": meta, "trace": trace}

        if prior.get("_build_failed"):
            meta = {
                "intent": "criacao_leitura_word",
                "model_provider": mp,
                "error_kind": "documents_build_failed",
            }
            text = state.get("assistant_text") or "Não foi possível gerar o documento."
            return {"assistant_text": text, "metadata": meta, "trace": trace}

        docx_bytes = state.get("docx_bytes") or b""
        filename = state.get("docx_filename") or "documento.docx"
        spec_summary = prior.get("_spec_summary") or {}
        meta = build_docx_metadata(
            docx_bytes,
            filename=filename,
            extra={
                "intent": "criacao_leitura_word",
                "routed_intent": "criacao_leitura_word",
                "model_provider": mp,
                "documents_full": {**spec_summary, "trace": state.get("trace") or []},
            },
        )
        verb = "editei" if mode == "edit" else "criei"
        doc_legacy_note = ""
        if ".doc" in query and ".docx" not in query:
            doc_legacy_note = (
                " Nota: o formato .doc legado não é gerado nativamente; "
                "o ficheiro disponível é .docx (compatível com Word moderno)."
            )
        text = state.get("assistant_text") or (
            f"Pronto — {verb} o documento **{filename}**. "
            f"Use o cartão abaixo para descarregar o ficheiro .docx.{doc_legacy_note}"
        )
        return {"assistant_text": text, "metadata": meta, "trace": trace}

    g = StateGraph(DocumentsFullState)
    g.add_node("parse", node_parse)
    g.add_node("answer", node_answer)
    g.add_node("spec", node_spec)
    g.add_node("build", node_build)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "parse")
    g.add_conditional_edges("parse", _route, {"answer": "answer", "spec": "spec"})
    g.add_edge("answer", "finalize")
    g.add_edge("spec", "build")
    g.add_edge("build", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


_compiled: Any = None


def get_documents_full_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_documents_full_graph(settings)
    return _compiled


def reset_documents_full_graph_cache() -> None:
    global _compiled
    _compiled = None


def _initial_state(
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
) -> DocumentsFullState:
    capped = tail_messages(messages)
    return {
        "messages": capped,
        "model_provider": model_provider,
        "user_query": last_user_text(capped, 6000),
        "conv_summary": conversation_summary(capped),
        "attachments": attachments or [],
        "trace": [],
    }


async def run_documents_full_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_documents_full_graph(settings)
    state_in = _initial_state(messages, model_provider, attachments)
    out = await graph.ainvoke(state_in)
    text = str(out.get("assistant_text") or "").strip()
    meta = out.get("metadata") if isinstance(out.get("metadata"), dict) else {}
    meta = _strip_internal(meta)
    meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
    return text, meta


def _strip_internal(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in (meta or {}).items() if not k.startswith("_")}


_PROGRESS_LABELS: dict[str, str] = {
    "doc_parse": "A ler e interpretar o documento…",
    "doc_spec": "A desenhar a estrutura do documento…",
    "doc_build": "A gerar o ficheiro .docx…",
    "doc_answer": "A analisar o conteúdo e preparar a resposta…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "parse": "doc_answer",
    "spec": "doc_build",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"document_kind": "docx_result", "phase": step},
    }


async def run_documents_full_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    graph = get_documents_full_graph(settings)
    state_in = _initial_state(messages, model_provider, attachments)
    yield _progress_event("doc_parse")
    merged: dict[str, Any] = dict(state_in)
    try:
        async for chunk in graph.astream(state_in):
            for node_name, patch in chunk.items():
                if isinstance(patch, dict):
                    if "metadata" in patch and isinstance(patch["metadata"], dict):
                        prev_meta = (
                            merged.get("metadata")
                            if isinstance(merged.get("metadata"), dict)
                            else {}
                        )
                        merged_meta = dict(prev_meta)
                        merged_meta.update(patch["metadata"])
                        merged.update(patch)
                        merged["metadata"] = merged_meta
                    else:
                        merged.update(patch)
                if node_name == "parse":
                    nxt = "doc_answer" if merged.get("mode") == "read" else "doc_spec"
                    yield _progress_event(nxt)
                else:
                    nxt = _NEXT_PROGRESS.get(node_name)
                    if nxt:
                        yield _progress_event(nxt)
        text = str(merged.get("assistant_text") or "").strip()
        meta = merged.get("metadata") if isinstance(merged.get("metadata"), dict) else {}
        meta = _strip_internal(meta)
        meta = await finalize_reply_metadata(settings, model_provider, messages, agent_memory, meta)
        yield {"type": "done", "assistant_text": text, "metadata": meta}
    except Exception as exc:
        _logger.exception("documents_full pipeline failed")
        yield {
            "type": "done",
            "assistant_text": f"Não foi possível processar o documento. Detalhe: {str(exc)[:300]}",
            "metadata": {
                "intent": "criacao_leitura_word",
                "error_kind": "documents_full_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
