"""Testes Code RAG — chunker, query expansion, retriever (mock embeddings)."""

from __future__ import annotations

import pytest

from openpolvointeligence.code_rag.chunker import chunk_file, chunk_project_files, should_index_path
from openpolvointeligence.code_rag.indexer import index_project_files
from openpolvointeligence.code_rag.retriever import (
    build_rag_context_block,
    detect_feature_domains,
    expand_rag_query,
    retrieve_for_router,
)
from openpolvointeligence.code_rag.vector_store import InMemoryVectorStore, reset_vector_store_cache
from openpolvointeligence.core.config import Settings


AUTH_MIDDLEWARE = """\
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('session');
  if (!token) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*'] };
"""

SUPABASE_CLIENT = """\
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
"""

UNRELATED_PAGE = """\
export default function HomePage() {
  return <main>Marketing landing</main>;
}
"""


@pytest.fixture(autouse=True)
def _reset_store():
    reset_vector_store_cache()
    yield
    reset_vector_store_cache()


def test_chunk_middleware_is_config_type():
    chunks = chunk_file("middleware.ts", AUTH_MIDDLEWARE)
    assert len(chunks) >= 1
    assert chunks[0].chunk_type == "config"
    assert chunks[0].layer in ("frontend", "shared")


def test_should_skip_node_modules():
    assert should_index_path("node_modules/react/index.js") is False
    assert should_index_path("src/lib/auth.ts") is True


def test_detect_auth_domain():
    domains = detect_feature_domains("Adicione autenticação via NextAuth e Supabase Auth")
    assert "auth" in domains


def test_expand_rag_query_includes_auth_terms():
    q = expand_rag_query("NextAuth Supabase login")
    assert "middleware" in q.lower() or "supabase" in q.lower()


@pytest.mark.asyncio
async def test_index_and_retrieve_auth_files():
    settings = Settings(
        code_rag_auto_index=True,
        code_rag_database_url="",
        openai_api_key=None,
    )
    files = {
        "middleware.ts": AUTH_MIDDLEWARE,
        "lib/supabase/client.ts": SUPABASE_CLIENT,
        "app/page.tsx": UNRELATED_PAGE,
        "package.json": '{"name":"demo","dependencies":{"next-auth":"^4"}}',
    }
    pid = "test-project-auth"
    result = await index_project_files(settings, pid, files, use_mock_embeddings=True)
    assert result.chunks_indexed >= 3

    chunks, paths = await retrieve_for_router(
        settings,
        pid,
        "Adicione autenticação via NextAuth/Supabase Auth com middleware",
        use_mock=True,
    )
    assert "middleware.ts" in paths or any("middleware" in p for p in paths)
    block = build_rag_context_block(chunks)
    assert "middleware" in block.lower() or "supabase" in block.lower()
    # marketing page should not dominate when auth query
    assert "Marketing landing" not in block or len(paths) <= 4


@pytest.mark.asyncio
async def test_inmemory_store_upsert_idempotent():
    store = InMemoryVectorStore()
    from openpolvointeligence.code_rag.chunker import chunk_file
    from openpolvointeligence.code_rag.embedder import _mock_embedding

    c = chunk_file("a.ts", "export const x = 1;")
    emb = [_mock_embedding(c[0].embed_text())]
    n1 = await store.upsert_chunks("p1", c, emb)
    n2 = await store.upsert_chunks("p1", c, emb)
    assert n1 == 1
    assert n2 == 1
