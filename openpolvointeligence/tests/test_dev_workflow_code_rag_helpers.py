"""Testes dos helpers de RAG por etapa, project_id estável e memória de erros."""

from __future__ import annotations

import pytest

from openpolvointeligence.code_rag.vector_store import reset_vector_store_cache
from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
    reindex_project_files,
    retrieve_for_architect,
    retrieve_for_codegen_task,
    retrieve_for_reviewer,
    stable_project_id,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_error_memory import (
    build_error_memory_block,
    error_memory_namespace,
    error_signature,
    index_error_fix,
    recall_similar_errors,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_graph import (
    _stable_project_id_for_pipeline,
)

AUTH_ROUTE = """\
import { Hono } from 'hono';
export const auth = new Hono();
auth.post('/login', async (c) => c.json({ ok: true }));
"""

HOME_PAGE = """\
export default function HomePage() {
  return <main>Bem-vindo</main>;
}
"""


@pytest.fixture(autouse=True)
def _reset_store():
    reset_vector_store_cache()
    yield
    reset_vector_store_cache()


def _settings() -> Settings:
    return Settings(code_rag_database_url="", openai_api_key=None)


def test_stable_project_id_prefers_conversation_id():
    state = {
        "conversation_id": "conv-123",
        "sandbox_project_id": "sb-9",
        "workspace_id": "ws-1",
    }
    assert stable_project_id(state) == "conv-123"


def test_stable_project_id_fallback_chain():
    assert stable_project_id({"sandbox_project_id": "sb-9"}) == "sb-9"
    assert stable_project_id({"workspace_id": "ws-1"}) == "ws-1"
    assert stable_project_id({}) == "default-dev-studio-project"


def test_stable_project_id_reads_metadata_dev_studio_context():
    state = {"metadata": {"dev_studio_context": {"project_id": "from-meta"}}}
    assert stable_project_id(state) == "from-meta"


def test_pipeline_stable_project_id_helper():
    assert _stable_project_id_for_pipeline("conv-1", "ws-1", {}) == "conv-1"
    assert _stable_project_id_for_pipeline(None, "ws-1", {}) == "ws-1"
    assert _stable_project_id_for_pipeline(None, None, {"project_id": "prev"}) == "prev"
    assert _stable_project_id_for_pipeline(None, None, {}) == "default-dev-studio-project"


async def test_retrieve_for_architect_returns_indexed_paths():
    settings = _settings()
    pid = "conv-arch"
    files = {"server/routes/auth.ts": AUTH_ROUTE, "src/pages/HomePage.tsx": HOME_PAGE}
    n = await reindex_project_files(settings, pid, files)
    assert n >= 1

    block, paths = await retrieve_for_architect(
        settings,
        pid,
        "adiciona endpoint de login com sessão",
        feature_summary="auth",
    )
    assert paths
    assert any("auth" in p for p in paths) or any("auth" in p for p in paths)
    assert isinstance(block, str)


async def test_retrieve_for_codegen_and_reviewer_smoke():
    settings = _settings()
    pid = "conv-code"
    await reindex_project_files(settings, pid, {"src/pages/HomePage.tsx": HOME_PAGE})
    block_c, paths_c = await retrieve_for_codegen_task(settings, pid, "src/pages/HomePage.tsx")
    block_r, paths_r = await retrieve_for_reviewer(settings, pid, "ajusta a HomePage")
    assert isinstance(block_c, str) and isinstance(paths_c, list)
    assert isinstance(block_r, str) and isinstance(paths_r, list)


async def test_retrieve_empty_query_returns_empty():
    settings = _settings()
    block, paths = await retrieve_for_architect(settings, "conv-x", "")
    assert block == ""
    assert paths == []


def test_error_memory_namespace_and_signature():
    assert error_memory_namespace("conv-1") == "errmem::conv-1"
    assert error_memory_namespace(None) == "errmem::default"
    sig = error_signature(
        [{"path": "src/App.tsx", "message": "TS2322: type error"}],
    )
    assert "src/App.tsx" in sig
    assert "TS2322" in sig


async def test_error_memory_index_and_recall():
    settings = _settings()
    pid = "conv-errmem"
    digest = [{"path": "src/App.tsx", "line": 12, "message": "TS2322: not assignable"}]
    ok = await index_error_fix(
        settings,
        pid,
        error_digest=digest,
        fix_summary="Converti string para number na linha 12.",
        root_cause="tipo",
    )
    assert ok is True

    recalled = await recall_similar_errors(settings, pid, digest)
    assert recalled
    assert recalled[0]["fix_summary"]
    block = build_error_memory_block(recalled)
    assert "Memória de erros" in block


async def test_error_memory_recall_empty_without_signature():
    settings = _settings()
    recalled = await recall_similar_errors(settings, "conv-none", [])
    assert recalled == []
    assert build_error_memory_block([]) == ""
