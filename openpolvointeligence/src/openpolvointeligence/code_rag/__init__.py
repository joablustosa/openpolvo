"""Code RAG — indexação e recuperação semântica de código."""

from openpolvointeligence.code_rag.indexer import index_project_files, index_project_from_disk
from openpolvointeligence.code_rag.retriever import (
    build_rag_context_block,
    retrieve_for_router,
)

__all__ = [
    "build_rag_context_block",
    "index_project_files",
    "index_project_from_disk",
    "retrieve_for_router",
]
