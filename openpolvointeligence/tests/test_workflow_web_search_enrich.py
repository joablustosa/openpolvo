"""Testes leves do enriquecimento web_search de workflows."""

from __future__ import annotations

import pytest

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.workflow_builder.workflow_web_search_enrich import run_workflow_web_search_enrich


@pytest.mark.asyncio
async def test_enrich_empty_organic_returns_message() -> None:
    s = Settings()
    out = await run_workflow_web_search_enrich(s, "openai", query="q", organic=[])
    assert "Sem URLs" in out


@pytest.mark.asyncio
async def test_enrich_no_safe_urls() -> None:
    s = Settings()
    organic = [{"title": "x", "link": "https://127.0.0.1/secret", "snippet": "bad"}]
    out = await run_workflow_web_search_enrich(s, "openai", query="q", organic=organic)
    assert "elegível" in out or "Nenhuma" in out
