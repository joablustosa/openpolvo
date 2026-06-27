"""Integração Code RAG ↔ LangGraph Dev Workflow.

Centraliza a resolução do `project_id` estável (chave do índice vectorial) e
expõe helpers de recuperação reutilizáveis por etapa (router, architect, codegen
por-tarefa e reviewers), além de re-indexar o código gerado após o codegen e o
self-heal para que a próxima busca veja a versão mais recente.
"""

from __future__ import annotations

import logging
from typing import Any

from openpolvointeligence.code_rag.indexer import index_project_files
from openpolvointeligence.code_rag.retriever import (
    build_rag_context_block,
    filter_manifest_to_rag_paths,
    retrieve_for_router,
)
from openpolvointeligence.core.config import Settings

_logger = logging.getLogger(__name__)

_FALLBACK_PROJECT_ID = "default-dev-studio-project"


def stable_project_id(state: dict[str, Any]) -> str:
    """ID estável do projecto para o índice vectorial.

    Ordem de preferência (a `conversation_id` é a chave primária do contrato):
    `conversation_id` → `sandbox_project_id` → `workspace_id` → `project_id`
    → `metadata.dev_studio_context.project_id` → `metadata.project_id`.
    """
    for key in ("conversation_id", "sandbox_project_id", "workspace_id", "project_id"):
        val = state.get(key)
        if val and str(val).strip():
            return str(val).strip()
    meta = state.get("metadata")
    if isinstance(meta, dict):
        dsc = meta.get("dev_studio_context")
        if isinstance(dsc, dict) and dsc.get("project_id"):
            return str(dsc["project_id"]).strip()
        if meta.get("project_id"):
            return str(meta["project_id"]).strip()
    return _FALLBACK_PROJECT_ID


# Compatibilidade retro: nome antigo usado noutros módulos/testes.
def resolve_project_id(state: dict[str, Any]) -> str:
    return stable_project_id(state)


def _use_mock(settings: Settings) -> bool:
    return not (settings.openai_api_key or "").strip()


async def reindex_project_files(
    settings: Settings,
    project_id: str,
    project_files: dict[str, str],
) -> int:
    """Re-indexa o snapshot actual do projecto; devolve nº de chunks indexados.

    Degrada graciosamente: erros de indexação não devem quebrar o pipeline.
    """
    if not project_id or not isinstance(project_files, dict) or not project_files:
        return 0
    try:
        result = await index_project_files(
            settings,
            project_id,
            project_files,
            use_mock_embeddings=_use_mock(settings),
        )
    except Exception as exc:  # indexação é best-effort
        _logger.warning("Code RAG reindex falhou project=%s: %s", project_id, exc)
        return 0
    return result.chunks_indexed


async def _retrieve_block(
    settings: Settings,
    project_id: str,
    query: str,
    *,
    top_k: int | None = None,
) -> tuple[str, list[str]]:
    """Núcleo partilhado: busca semântica → (bloco compacto, paths)."""
    if not project_id or not (query or "").strip():
        return "", []
    try:
        chunks, paths = await retrieve_for_router(
            settings,
            project_id,
            query,
            top_k=top_k,
            use_mock=_use_mock(settings),
        )
    except Exception as exc:
        _logger.warning("Code RAG retrieve falhou project=%s: %s", project_id, exc)
        return "", []
    return build_rag_context_block(chunks), paths


async def retrieve_for_architect(
    settings: Settings,
    project_id: str,
    user_prompt: str,
    *,
    feature_summary: str = "",
) -> tuple[str, list[str]]:
    """Contexto RAG para o Architect planear só dentro do scope recuperado."""
    query = user_prompt
    if feature_summary.strip():
        query = f"{user_prompt}\n\nfeature: {feature_summary}"
    return await _retrieve_block(settings, project_id, query)


async def retrieve_for_codegen_task(
    settings: Settings,
    project_id: str,
    task_path: str,
    *,
    feature_summary: str = "",
) -> tuple[str, list[str]]:
    """Contexto RAG focado num ficheiro/tarefa específica do codegen."""
    query_parts = [p for p in (task_path, feature_summary) if p and p.strip()]
    query = "\n".join(query_parts) or task_path
    return await _retrieve_block(settings, project_id, query, top_k=6)


async def retrieve_for_reviewer(
    settings: Settings,
    project_id: str,
    user_prompt: str,
) -> tuple[str, list[str]]:
    """Contexto RAG para os reviewers avaliarem contra o código existente."""
    return await _retrieve_block(settings, project_id, user_prompt)


async def run_code_rag_for_router(
    settings: Settings,
    state: dict[str, Any],
) -> dict[str, Any]:
    """
    Indexa (se necessário) + busca semântica antes do nó Router.

    Devolve campos para merge no DevWorkflowState.
    """
    project_id = stable_project_id(state)
    user_prompt = str(state.get("user_prompt") or "")
    project_files = state.get("project_files") or {}

    if settings.code_rag_auto_index and isinstance(project_files, dict) and project_files:
        await reindex_project_files(settings, project_id, project_files)

    chunks, paths = await retrieve_for_router(
        settings,
        project_id,
        user_prompt,
        use_mock=_use_mock(settings),
    )

    all_paths = list(state.get("project_file_tree") or [])
    if not all_paths and project_files:
        all_paths = sorted(project_files.keys())

    filtered_tree, skipped = filter_manifest_to_rag_paths(all_paths, paths)
    rag_block = build_rag_context_block(chunks)

    return {
        "project_id": project_id,
        "rag_relevant_paths": paths,
        "rag_context_block": rag_block or None,
        "rag_skipped_paths": skipped,
        "project_file_tree": filtered_tree if paths else all_paths,
    }
