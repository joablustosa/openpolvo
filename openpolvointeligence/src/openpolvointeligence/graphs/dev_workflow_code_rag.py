"""Integração Code RAG ↔ LangGraph Dev Workflow."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.code_rag.indexer import index_project_files
from openpolvointeligence.code_rag.retriever import (
    build_rag_context_block,
    filter_manifest_to_rag_paths,
    retrieve_for_router,
)
from openpolvointeligence.core.config import Settings


def resolve_project_id(state: dict[str, Any]) -> str:
    """ID estável do projecto para o índice vectorial."""
    for key in ("project_id", "workspace_id"):
        val = state.get(key)
        if val and str(val).strip():
            return str(val).strip()
    meta = state.get("metadata")
    if isinstance(meta, dict) and meta.get("project_id"):
        return str(meta["project_id"]).strip()
    return "default-dev-studio-project"


async def run_code_rag_for_router(
    settings: Settings,
    state: dict[str, Any],
) -> dict[str, Any]:
    """
    Indexa (se necessário) + busca semântica antes do nó Router.

    Devolve campos para merge no DevWorkflowState.
    """
    project_id = resolve_project_id(state)
    user_prompt = str(state.get("user_prompt") or "")
    project_files = state.get("project_files") or {}

    if settings.code_rag_auto_index and isinstance(project_files, dict) and project_files:
        await index_project_files(
            settings,
            project_id,
            project_files,
            use_mock=not (settings.openai_api_key or "").strip(),
        )

    chunks, paths = await retrieve_for_router(
        settings,
        project_id,
        user_prompt,
        use_mock=not (settings.openai_api_key or "").strip(),
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
