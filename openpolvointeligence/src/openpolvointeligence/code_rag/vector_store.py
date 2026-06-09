"""Armazenamento vectorial — pgvector (prod) + memória (dev/testes)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Protocol, Sequence

from openpolvointeligence.code_rag.types import ChunkType, CodeChunk, LayerHint, RetrievedChunk

_logger = logging.getLogger(__name__)


class VectorStore(Protocol):
    async def upsert_chunks(
        self,
        project_id: str,
        chunks: Sequence[CodeChunk],
        embeddings: Sequence[list[float]],
    ) -> int: ...

    async def search(
        self,
        project_id: str,
        query_embedding: list[float],
        *,
        top_k: int = 8,
        chunk_types: Sequence[ChunkType] | None = None,
        layers: Sequence[LayerHint] | None = None,
        path_prefixes: Sequence[str] | None = None,
    ) -> list[RetrievedChunk]: ...

    async def delete_project(self, project_id: str) -> None: ...


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class InMemoryVectorStore:
    """Fallback quando DATABASE_URL / pgvector não estão disponíveis."""

    def __init__(self) -> None:
        self._rows: dict[str, list[dict[str, Any]]] = {}

    async def upsert_chunks(
        self,
        project_id: str,
        chunks: Sequence[CodeChunk],
        embeddings: Sequence[list[float]],
    ) -> int:
        rows = self._rows.setdefault(project_id, [])
        by_key = {
            (r["path"], r.get("symbol_name") or "", r["start_line"]): i for i, r in enumerate(rows)
        }
        n = 0
        for chunk, emb in zip(chunks, embeddings, strict=True):
            key = (chunk.path, chunk.symbol_name or "", chunk.start_line)
            row = {
                "path": chunk.path,
                "chunk_type": chunk.chunk_type,
                "symbol_name": chunk.symbol_name,
                "layer": chunk.layer,
                "start_line": chunk.start_line,
                "end_line": chunk.end_line,
                "content": chunk.content,
                "embedding": emb,
                "metadata": chunk.metadata,
            }
            if key in by_key:
                rows[by_key[key]] = row
            else:
                rows.append(row)
                by_key[key] = len(rows) - 1
            n += 1
        return n

    async def search(
        self,
        project_id: str,
        query_embedding: list[float],
        *,
        top_k: int = 8,
        chunk_types: Sequence[ChunkType] | None = None,
        layers: Sequence[LayerHint] | None = None,
        path_prefixes: Sequence[str] | None = None,
    ) -> list[RetrievedChunk]:
        rows = self._rows.get(project_id, [])
        scored: list[tuple[float, dict[str, Any]]] = []
        for row in rows:
            if chunk_types and row["chunk_type"] not in chunk_types:
                continue
            if layers and row["layer"] not in layers:
                continue
            if path_prefixes and not any(row["path"].startswith(p) for p in path_prefixes):
                continue
            score = _cosine_similarity(query_embedding, row["embedding"])
            scored.append((score, row))
        scored.sort(key=lambda x: x[0], reverse=True)
        out: list[RetrievedChunk] = []
        for score, row in scored[:top_k]:
            out.append(
                RetrievedChunk(
                    path=row["path"],
                    chunk_type=row["chunk_type"],
                    symbol_name=row.get("symbol_name"),
                    layer=row["layer"],
                    score=score,
                    excerpt=row["content"][:1200],
                    start_line=row["start_line"],
                    end_line=row["end_line"],
                    metadata=row.get("metadata") or {},
                ),
            )
        return out

    async def delete_project(self, project_id: str) -> None:
        self._rows.pop(project_id, None)


class PgVectorStore:
    """PostgreSQL + pgvector."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    async def _connect(self):
        import psycopg

        return await psycopg.AsyncConnection.connect(self._dsn)

    async def upsert_chunks(
        self,
        project_id: str,
        chunks: Sequence[CodeChunk],
        embeddings: Sequence[list[float]],
    ) -> int:
        if not chunks:
            return 0
        async with await self._connect() as conn:
            async with conn.cursor() as cur:
                n = 0
                for chunk, emb in zip(chunks, embeddings, strict=True):
                    embed_text = chunk.embed_text()
                    await cur.execute(
                        """
                        INSERT INTO code_rag_chunks (
                            id, project_id, path, chunk_type, symbol_name,
                            start_line, end_line, layer, content_hash, content,
                            embedding, metadata
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s::jsonb
                        )
                        ON CONFLICT (project_id, path, COALESCE(symbol_name, ''), start_line)
                        DO UPDATE SET
                            chunk_type = EXCLUDED.chunk_type,
                            end_line = EXCLUDED.end_line,
                            layer = EXCLUDED.layer,
                            content_hash = EXCLUDED.content_hash,
                            content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata,
                            indexed_at = NOW()
                        """,
                        (
                            str(uuid.uuid4()),
                            project_id,
                            chunk.path,
                            chunk.chunk_type,
                            chunk.symbol_name,
                            chunk.start_line,
                            chunk.end_line,
                            chunk.layer,
                            chunk.content_hash,
                            embed_text,
                            _vector_literal(emb),
                            json.dumps(chunk.metadata, ensure_ascii=False),
                        ),
                    )
                    n += 1
                await conn.commit()
        return n

    async def search(
        self,
        project_id: str,
        query_embedding: list[float],
        *,
        top_k: int = 8,
        chunk_types: Sequence[ChunkType] | None = None,
        layers: Sequence[LayerHint] | None = None,
        path_prefixes: Sequence[str] | None = None,
    ) -> list[RetrievedChunk]:
        qvec = _vector_literal(query_embedding)
        async with await self._connect() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT path, chunk_type, symbol_name, layer, start_line, end_line,
                           content, metadata,
                           1 - (embedding <=> %s::vector) AS score
                    FROM code_rag_chunks
                    WHERE project_id = %s
                      AND (%s OR chunk_type = ANY(%s))
                      AND (%s OR layer = ANY(%s))
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (
                        qvec,
                        project_id,
                        chunk_types is None,
                        list(chunk_types) if chunk_types else [],
                        layers is None,
                        list(layers) if layers else [],
                        qvec,
                        top_k * 2 if path_prefixes else top_k,
                    ),
                )
                rows = await cur.fetchall()

        out: list[RetrievedChunk] = []
        for row in rows:
            path = str(row[0])
            if path_prefixes and not any(path.startswith(p) for p in path_prefixes):
                continue
            out.append(
                RetrievedChunk(
                    path=path,
                    chunk_type=row[1],
                    symbol_name=row[2],
                    layer=row[3] or "shared",
                    start_line=row[4],
                    end_line=row[5],
                    excerpt=(row[6] or "")[:1200],
                    score=float(row[8] or 0),
                    metadata=row[7] if isinstance(row[7], dict) else {},
                ),
            )
            if len(out) >= top_k:
                break
        return out

    async def delete_project(self, project_id: str) -> None:
        async with await self._connect() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM code_rag_chunks WHERE project_id = %s", (project_id,)
                )
                await conn.commit()


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in values) + "]"


_store_singleton: VectorStore | None = None


def get_vector_store(dsn: str | None) -> VectorStore:
    global _store_singleton
    if _store_singleton is not None:
        return _store_singleton
    if dsn and dsn.strip():
        try:
            _store_singleton = PgVectorStore(dsn.strip())
            _logger.info("Code RAG: pgvector store activo")
            return _store_singleton
        except Exception as e:
            _logger.warning("Code RAG: pgvector indisponível (%s), memória", e)
    _store_singleton = InMemoryVectorStore()
    return _store_singleton


def reset_vector_store_cache() -> None:
    global _store_singleton
    _store_singleton = None
