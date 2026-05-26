"""Embeddings OpenAI (text-embedding-3-small, 1536 dims)."""

from __future__ import annotations

import hashlib
from typing import Sequence

from openpolvointeligence.core.config import Settings


def embedding_model_name(settings: Settings) -> str:
    raw = getattr(settings, "code_rag_embedding_model", None)
    return (raw or "text-embedding-3-small").strip()


def _mock_embedding(text: str, dims: int = 1536) -> list[float]:
    """Embedding determinístico para testes sem API key."""
    h = hashlib.sha256(text.encode("utf-8")).digest()
    out: list[float] = []
    for i in range(dims):
        b = h[i % len(h)]
        out.append((b / 127.5) - 1.0)
    return out


async def embed_texts(
    settings: Settings,
    texts: Sequence[str],
    *,
    use_mock: bool = False,
) -> list[list[float]]:
    if not texts:
        return []
    if use_mock or not (settings.openai_api_key or "").strip():
        return [_mock_embedding(t) for t in texts]

    from langchain_openai import OpenAIEmbeddings

    client = OpenAIEmbeddings(
        model=embedding_model_name(settings),
        openai_api_key=settings.openai_api_key,
    )
    return await client.aembed_documents(list(texts))


async def embed_query(settings: Settings, query: str, *, use_mock: bool = False) -> list[float]:
    if use_mock or not (settings.openai_api_key or "").strip():
        return _mock_embedding(query)
    from langchain_openai import OpenAIEmbeddings

    client = OpenAIEmbeddings(
        model=embedding_model_name(settings),
        openai_api_key=settings.openai_api_key,
    )
    return await client.aembed_query(query)
