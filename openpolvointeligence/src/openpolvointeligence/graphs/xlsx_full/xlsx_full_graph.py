"""Grafo LangGraph unificado: ler/interpretar/criar/editar planilhas (.xlsx/.csv).

Combina o padrão de ``pdf_read`` (ler anexo → responder no chat) com o de
``pdf_study`` (devolver ficheiro real via ``metadata.*_base64`` + cartão de download).
Camada determinística primeiro (parse/digest/build openpyxl, zero-token); o LLM só
entra para responder (read) ou produzir a *spec* JSON (create/edit). O binário .xlsx
é sempre gerado pelo builder determinístico — nunca pelo modelo.
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
from openpolvointeligence.graphs.xlsx_full.xlsx_build_logic import (
    XlsxBuildError,
    apply_edit_ops,
    build_xlsx_bytes,
    build_xlsx_metadata,
    ensure_xlsx_filename,
)
from openpolvointeligence.graphs.xlsx_full.xlsx_full_routing import (
    classify_xlsx_intent,
    xlsx_attachments,
)
from openpolvointeligence.graphs.xlsx_full.xlsx_full_state import XlsxFullState
from openpolvointeligence.graphs.xlsx_full.xlsx_read_logic import (
    decode_attachment,
    digest_to_markdown,
    read_workbook_digest,
)
from openpolvointeligence.graphs.xlsx_full.xlsx_spec_logic import (
    normalize_edit_plan,
    normalize_workbook_spec,
    parse_json_block,
    validate_edit_plan,
    validate_workbook_spec,
)

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "xlsx_full"

_DIGEST_BUDGET_CHARS = 12_000


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _clip(s: str, max_len: int) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def _read_digests(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    digests: list[dict[str, Any]] = []
    for att in xlsx_attachments(attachments):
        filename = str(att.get("name") or "planilha.xlsx")
        data = decode_attachment(att)
        if not data:
            digests.append(
                {
                    "filename": filename,
                    "kind": "?",
                    "sheets": [],
                    "error": "Anexo ilegível (base64 inválido).",
                }
            )
            continue
        digest = read_workbook_digest(
            data, filename=filename, mime_type=str(att.get("mime_type") or "")
        )
        # Bytes originais para o modo edit; vivem só na metadata interna (_digests é
        # removida antes de devolver ao cliente por _strip_internal).
        digest["_raw"] = data
        digests.append(digest)
    return digests


def _digests_markdown(digests: list[dict[str, Any]]) -> str:
    return "\n\n".join(digest_to_markdown(d) for d in digests).strip()


def _digest_stats(digests: list[dict[str, Any]]) -> dict[str, Any]:
    sheets = sum(len(d.get("sheets") or []) for d in digests)
    rows = sum(int(s.get("max_row") or 0) for d in digests for s in (d.get("sheets") or []))
    cols = sum(int(s.get("max_col") or 0) for d in digests for s in (d.get("sheets") or []))
    return {"files": len(digests), "sheets": sheets, "rows": rows, "cols": cols}


def build_xlsx_full_graph(settings: Settings) -> Any:
    answer_sys = _load_prompt("answer_query")
    design_sys = _load_prompt("design_workbook")
    edit_sys = _load_prompt("edit_workbook")

    def node_parse(state: XlsxFullState) -> dict[str, Any]:
        attachments = state.get("attachments") or []
        digests = _read_digests(attachments)
        mode = classify_xlsx_intent(state.get("user_query") or "", has_attachment=bool(digests))
        trace = list(state.get("trace") or []) + [f"parse:{mode}"]
        return {"mode": mode, "metadata": {"_digests": digests}, "trace": trace}

    def _route(state: XlsxFullState) -> str:
        return "answer" if state.get("mode") == "read" else "spec"

    async def node_answer(state: XlsxFullState) -> dict[str, Any]:
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        md = _digests_markdown(digests or [])
        query = (state.get("user_query") or "").strip()
        summary = state.get("conv_summary") or ""
        trace = list(state.get("trace") or []) + ["answer"]
        if not md:
            return {
                "assistant_text": (
                    "Não consegui ler a planilha anexada. Verifique se o ficheiro é um .xlsx ou "
                    ".csv válido e não está protegido."
                ),
                "trace": trace,
            }
        human = (
            f"PERGUNTA DO UTILIZADOR:\n{query or '(sem pergunta explícita — apenas a planilha foi anexada)'}\n\n"
            f"HISTÓRICO RECENTE:\n{summary}\n\n"
            f"CONTEÚDO DA(S) PLANILHA(S):\n{_clip(md, _DIGEST_BUDGET_CHARS)}"
        )
        try:
            chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
            resp = await chat.ainvoke(
                [SystemMessage(content=answer_sys), HumanMessage(content=human)]
            )
            text = str(resp.content).strip()
        except Exception as exc:  # noqa: BLE001
            _logger.warning("xlsx_full answer failed: %s", exc)
            text = (
                "Li a planilha, mas não foi possível gerar a análise com o modelo selecionado. "
                f"Detalhe: {str(exc)[:200]}"
            )
        return {"assistant_text": text, "trace": trace}

    async def node_spec(state: XlsxFullState) -> dict[str, Any]:
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
                f"PLANILHA ATUAL (digest):\n{_clip(md, _DIGEST_BUDGET_CHARS)}"
            )
        else:
            sys = design_sys
            human = f"PEDIDO:\n{query}\n\nHISTÓRICO:\n{summary}"
        try:
            chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
            resp = await chat.ainvoke([SystemMessage(content=sys), HumanMessage(content=human)])
            raw = str(resp.content)
        except Exception as exc:  # noqa: BLE001
            _logger.warning("xlsx_full spec failed: %s", exc)
            return {"workbook_spec": {"_error": f"spec_failed: {str(exc)[:200]}"}, "trace": trace}
        parsed = parse_json_block(raw)
        if mode == "edit":
            plan = normalize_edit_plan(parsed)
            errs = validate_edit_plan(plan)
            return {
                "workbook_spec": {"_kind": "edit", "plan": plan, "_errors": errs},
                "trace": trace,
            }
        spec = normalize_workbook_spec(parsed)
        errs = validate_workbook_spec(spec)
        return {"workbook_spec": {"_kind": "create", "spec": spec, "_errors": errs}, "trace": trace}

    def node_build(state: XlsxFullState) -> dict[str, Any]:
        wrapper = state.get("workbook_spec") or {}
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        trace = list(state.get("trace") or []) + ["build"]
        errs = wrapper.get("_errors") or []
        if wrapper.get("_error") or errs:
            detail = wrapper.get("_error") or "; ".join(errs)
            return {
                "assistant_text": f"Não consegui montar a planilha: {detail}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        try:
            if wrapper.get("_kind") == "edit":
                source = next((d for d in (digests or []) if d.get("_raw")), None)
                src_bytes = source.get("_raw") if source else None
                if not src_bytes:
                    return {
                        "assistant_text": "Não encontrei o ficheiro original para editar.",
                        "metadata": {"_build_failed": True},
                        "trace": trace,
                    }
                xlsx_bytes = apply_edit_ops(src_bytes, wrapper["plan"])
                base_name = digests[0].get("filename") if digests else "planilha-editada.xlsx"
                filename = ensure_xlsx_filename(base_name)
                spec_summary = {"mode": "edit", "ops": len(wrapper["plan"].get("ops") or [])}
            else:
                spec = wrapper["spec"]
                xlsx_bytes = build_xlsx_bytes(spec)
                filename = ensure_xlsx_filename(spec.get("filename") or "planilha.xlsx")
                spec_summary = {
                    "mode": "create",
                    "sheets": len(spec.get("sheets") or []),
                    "filename": filename,
                }
        except XlsxBuildError as exc:
            return {
                "assistant_text": f"Geração de .xlsx indisponível: {exc}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        except Exception as exc:  # noqa: BLE001
            _logger.exception("xlsx build failed")
            return {
                "assistant_text": f"Falha ao gerar o ficheiro .xlsx: {str(exc)[:200]}",
                "metadata": {"_build_failed": True},
                "trace": trace,
            }
        return {
            "xlsx_bytes": xlsx_bytes,
            "xlsx_filename": filename,
            "metadata": {"_spec_summary": spec_summary},
            "trace": trace,
        }

    def node_finalize(state: XlsxFullState) -> dict[str, Any]:
        mode = state.get("mode") or "read"
        mp = effective_provider(state.get("model_provider"))
        prior = state.get("metadata") or {}
        digests = prior.get("_digests") if isinstance(prior, dict) else []
        trace = list(state.get("trace") or []) + ["finalize"]
        if mode == "read":
            stats = _digest_stats(digests or [])
            meta: dict[str, Any] = {
                "document_kind": "xlsx_read_result",
                "intent": "criacao_leitura_xlsx",
                "routed_intent": "criacao_leitura_xlsx",
                "model_provider": mp,
                "xlsx_full": {
                    "mode": "read",
                    "files": stats["files"],
                    "sheets": stats["sheets"],
                    "rows": stats["rows"],
                    "cols": stats["cols"],
                    "filenames": [d.get("filename") for d in (digests or [])],
                    "trace": state.get("trace") or [],
                },
            }
            return {"metadata": meta, "trace": trace}

        if prior.get("_build_failed"):
            meta = {
                "intent": "criacao_leitura_xlsx",
                "model_provider": mp,
                "error_kind": "xlsx_build_failed",
            }
            text = state.get("assistant_text") or "Não foi possível gerar a planilha."
            return {"assistant_text": text, "metadata": meta, "trace": trace}

        xlsx_bytes = state.get("xlsx_bytes") or b""
        filename = state.get("xlsx_filename") or "planilha.xlsx"
        spec_summary = prior.get("_spec_summary") or {}
        meta = build_xlsx_metadata(
            xlsx_bytes,
            filename=filename,
            extra={
                "intent": "criacao_leitura_xlsx",
                "routed_intent": "criacao_leitura_xlsx",
                "model_provider": mp,
                "xlsx_full": {**spec_summary, "trace": state.get("trace") or []},
            },
        )
        verb = "editei" if mode == "edit" else "criei"
        text = state.get("assistant_text") or (
            f"Pronto — {verb} a planilha **{filename}**. Use o cartão abaixo para descarregar o ficheiro .xlsx."
        )
        return {"assistant_text": text, "metadata": meta, "trace": trace}

    g = StateGraph(XlsxFullState)
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


def get_xlsx_full_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_xlsx_full_graph(settings)
    return _compiled


def reset_xlsx_full_graph_cache() -> None:
    global _compiled
    _compiled = None


def _initial_state(
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
) -> XlsxFullState:
    capped = tail_messages(messages)
    return {
        "messages": capped,
        "model_provider": model_provider,
        "user_query": last_user_text(capped, 6000),
        "conv_summary": conversation_summary(capped),
        "attachments": attachments or [],
        "trace": [],
    }


async def run_xlsx_full_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_xlsx_full_graph(settings)
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
    "xlsx_parse": "A ler e interpretar a planilha…",
    "xlsx_spec": "A desenhar a estrutura da planilha…",
    "xlsx_build": "A gerar o ficheiro .xlsx…",
    "xlsx_answer": "A analisar os dados e preparar a resposta…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "parse": "xlsx_answer",  # substituído por xlsx_spec quando mode != read
    "spec": "xlsx_build",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"document_kind": "xlsx_result", "phase": step},
    }


async def run_xlsx_full_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    attachments: list[dict[str, Any]] | None,
    *,
    agent_memory: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    graph = get_xlsx_full_graph(settings)
    state_in = _initial_state(messages, model_provider, attachments)
    yield _progress_event("xlsx_parse")
    merged: dict[str, Any] = dict(state_in)
    try:
        async for chunk in graph.astream(state_in):
            for node_name, patch in chunk.items():
                if isinstance(patch, dict):
                    # Preserva metadata interna acumulada (_digests, _edit_source_bytes).
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
                    nxt = "xlsx_answer" if merged.get("mode") == "read" else "xlsx_spec"
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
        _logger.exception("xlsx_full pipeline failed")
        yield {
            "type": "done",
            "assistant_text": f"Não foi possível processar a planilha. Detalhe: {str(exc)[:300]}",
            "metadata": {
                "intent": "criacao_leitura_xlsx",
                "error_kind": "xlsx_full_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
