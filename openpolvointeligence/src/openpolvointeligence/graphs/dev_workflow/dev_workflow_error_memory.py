"""RAG de memória de erros — pares erro→fix por conversa/projecto.

Guarda pares (assinatura do erro → resumo da correcção) num namespace vectorial
separado por `project_id`/`conversation_id`, para o self-healer consultar
correcções similares de turnos anteriores. Reutiliza o mesmo vector store do
Code RAG, mas num namespace dedicado (`errmem::<project_id>`) — nunca polui o
índice de código.

Determinístico na borda: usa embeddings mock quando não há API key (testes).
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from openpolvointeligence.code_rag.embedder import embed_query, embed_texts
from openpolvointeligence.code_rag.types import CodeChunk
from openpolvointeligence.code_rag.vector_store import get_vector_store
from openpolvointeligence.core.config import Settings

_logger = logging.getLogger(__name__)

_ERRMEM_PREFIX = "errmem::"


def error_memory_namespace(project_id: str | None) -> str:
    """Namespace vectorial dedicado à memória de erros do projecto/conversa."""
    return f"{_ERRMEM_PREFIX}{(project_id or 'default').strip() or 'default'}"


def error_signature(error_digest: list[dict[str, Any]]) -> str:
    """Texto canónico (assinatura) a partir do digest de erros para a busca."""
    parts: list[str] = []
    for e in (error_digest or [])[:6]:
        if not isinstance(e, dict):
            continue
        path = str(e.get("path") or "").strip()
        msg = str(e.get("message") or "").strip()
        if msg:
            parts.append(f"{path}: {msg}" if path else msg)
    return "\n".join(parts)


def _use_mock(settings: Settings) -> bool:
    return not (settings.openai_api_key or "").strip()


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


async def index_error_fix(
    settings: Settings,
    project_id: str | None,
    *,
    error_digest: list[dict[str, Any]],
    fix_summary: str,
    root_cause: str = "",
) -> bool:
    """Indexa um par erro→fix. Best-effort: não levanta em falha."""
    if not getattr(settings, "dev_workflow_error_memory_enabled", True):
        return False
    signature = error_signature(error_digest)
    if not signature or not fix_summary.strip():
        return False
    ns = error_memory_namespace(project_id)
    chunk = CodeChunk(
        path="__error_memory__",
        chunk_type="type",
        symbol_name=None,
        start_line=0,
        end_line=0,
        layer="shared",
        content=signature,
        content_hash=_content_hash(signature + fix_summary),
        metadata={
            "fix_summary": fix_summary.strip()[:400],
            "root_cause": (root_cause or "").strip()[:60],
        },
    )
    try:
        emb = await embed_texts(settings, [chunk.embed_text()], use_mock=_use_mock(settings))
        store = get_vector_store(
            (getattr(settings, "code_rag_database_url", None) or "").strip() or None,
        )
        await store.upsert_chunks(ns, [chunk], emb)
    except Exception as exc:  # memória de erros é best-effort
        _logger.warning("Error memory index falhou ns=%s: %s", ns, exc)
        return False
    return True


async def recall_similar_errors(
    settings: Settings,
    project_id: str | None,
    error_digest: list[dict[str, Any]],
    *,
    top_k: int = 3,
) -> list[dict[str, Any]]:
    """Recupera correcções passadas similares ao erro actual."""
    if not getattr(settings, "dev_workflow_error_memory_enabled", True):
        return []
    signature = error_signature(error_digest)
    if not signature:
        return []
    ns = error_memory_namespace(project_id)
    try:
        q_emb = await embed_query(settings, signature, use_mock=_use_mock(settings))
        store = get_vector_store(
            (getattr(settings, "code_rag_database_url", None) or "").strip() or None,
        )
        hits = await store.search(ns, q_emb, top_k=top_k)
    except Exception as exc:
        _logger.warning("Error memory recall falhou ns=%s: %s", ns, exc)
        return []

    out: list[dict[str, Any]] = []
    for h in hits:
        meta = h.metadata or {}
        out.append(
            {
                "error": h.excerpt,
                "fix_summary": str(meta.get("fix_summary") or ""),
                "root_cause": str(meta.get("root_cause") or ""),
                "score": round(float(h.score), 3),
            },
        )
    return out


def build_error_memory_block(recalled: list[dict[str, Any]]) -> str:
    """Bloco compacto para injectar no human message do self-healer."""
    items = [r for r in recalled if r.get("fix_summary")]
    if not items:
        return ""
    lines = ["## Memória de erros (correcções similares anteriores — referência)"]
    for r in items[:3]:
        lines.append(
            f"- [{r.get('root_cause') or 'fix'}] {r['fix_summary']} (score {r.get('score')})",
        )
    lines.append(
        "Reutiliza a abordagem que já funcionou se aplicável, mas valida no código actual."
    )
    return "\n".join(lines)
