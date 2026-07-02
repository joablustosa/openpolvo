"""Testes de resiliência LLM e scaffold fallback do dev workflow."""

from __future__ import annotations

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.llm_resilience import (
    build_provider_fallback_chain,
    format_dev_workflow_llm_error,
    is_llm_quota_error,
    is_llm_retriable_error,
)
from openpolvointeligence.graphs.dev_workflow.core.scaffold_fallback import (
    build_scaffold_fallback_patch,
    can_scaffold_fallback,
)


def test_is_llm_quota_error():
    err = Exception(
        "Error code: 429 - {'error': {'message': 'You exceeded your current quota'}}"
    )
    assert is_llm_quota_error(err)
    assert is_llm_retriable_error(err)


def test_format_quota_error_friendly():
    msg = format_dev_workflow_llm_error(
        "429 insufficient_quota",
        "openai",
        Settings(OPENAI_API_KEY="k"),
    )
    assert "429" in msg or "cota" in msg.lower()
    assert "Ollama" in msg or "ollama" in msg.lower()


def test_fallback_chain_includes_ollama_when_openai_primary():
    s = Settings(OPENAI_API_KEY="k1", OLLAMA_ENABLED=True)
    chain = build_provider_fallback_chain(s, "openai")
    assert chain[0] == "openai"
    assert "ollama" in chain


def test_scaffold_fallback_new_app():
    state = {
        "request_kind": "new_app",
        "user_prompt": "cria uma landing page de leads",
        "workspace_id": "/tmp/ws",
    }
    assert can_scaffold_fallback(state)
    patch = build_scaffold_fallback_patch(Settings(), state, llm_error="429 quota")
    assert patch.get("polvo_code_ops")
    assert patch["metadata"].get("polvo_code_create_project") is True
    assert patch["metadata"].get("scaffold_fallback") is True
    paths = {o["path"] for o in patch["polvo_code_ops"] if o.get("op") == "write"}
    assert any(p.endswith("package.json") for p in paths)
    assert any("/src/" in p or p.endswith("src/App.tsx") for p in paths)
