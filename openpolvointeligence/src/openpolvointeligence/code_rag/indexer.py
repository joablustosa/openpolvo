"""Indexação de projecto → chunks → embeddings → pgvector."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from openpolvointeligence.code_rag.chunker import chunk_project_files, iter_files_from_root
from openpolvointeligence.code_rag.embedder import embed_texts, embedding_model_name
from openpolvointeligence.code_rag.vector_store import get_vector_store
from openpolvointeligence.core.config import Settings

_logger = logging.getLogger(__name__)

BATCH_SIZE = 32


@dataclass
class IndexResult:
    project_id: str
    files_scanned: int
    chunks_indexed: int
    embedding_model: str
    store: str


async def index_project_files(
    settings: Settings,
    project_id: str,
    files: dict[str, str],
    *,
    use_mock_embeddings: bool = False,
) -> IndexResult:
    """Indexa mapa path→conteúdo (vindo do Dev Studio)."""
    chunks = chunk_project_files(files)
    if not chunks:
        return IndexResult(
            project_id=project_id,
            files_scanned=len(files),
            chunks_indexed=0,
            embedding_model=embedding_model_name(settings),
            store="none",
        )

    texts = [c.embed_text() for c in chunks]
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        all_embeddings.extend(
            await embed_texts(settings, batch, use_mock=use_mock_embeddings),
        )

    dsn = (getattr(settings, "code_rag_database_url", None) or "").strip() or None
    store = get_vector_store(dsn)
    n = await store.upsert_chunks(project_id, chunks, all_embeddings)
    store_name = "pgvector" if dsn else "memory"

    _logger.info(
        "Code RAG index project=%s files=%d chunks=%d store=%s",
        project_id,
        len(files),
        n,
        store_name,
    )
    return IndexResult(
        project_id=project_id,
        files_scanned=len(files),
        chunks_indexed=n,
        embedding_model=embedding_model_name(settings),
        store=store_name,
    )


async def index_project_from_disk(
    settings: Settings,
    project_id: str,
    root_path: str,
    *,
    use_mock_embeddings: bool = False,
) -> IndexResult:
    files = {path: content for path, content in iter_files_from_root(root_path)}
    return await index_project_files(
        settings,
        project_id,
        files,
        use_mock_embeddings=use_mock_embeddings,
    )


def new_project_id() -> str:
    return str(uuid.uuid4())
