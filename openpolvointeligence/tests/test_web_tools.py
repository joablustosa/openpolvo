"""Testes das web tools (web_search + web_fetch) expostas ao agente (A2/A3).

Sem rede real nem LLM real: mockam-se `fetch_organic_snippets` e `fetch_url_plaintext`.
Cobrem os executores partilhados, o registo no agente Desk (server-side, fora do
bridge) e o registo no loop de dev (READ_TOOLS + schemas + executor).
"""

from __future__ import annotations

import pytest

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.web_research import web_tools


# ── Executores partilhados ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_web_search_unavailable_without_key():
    s = Settings(serpapi_api_key=None)
    res = await web_tools.run_web_search(s, "langgraph docs")
    assert res["ok"] is False
    assert res["error"] == "web_search_unavailable"
    assert "SERPAPI_API_KEY" in res["hint"]


@pytest.mark.asyncio
async def test_web_search_empty_query():
    s = Settings(serpapi_api_key="k")
    res = await web_tools.run_web_search(s, "   ")
    assert res["ok"] is False
    assert res["error"] == "empty_query"


@pytest.mark.asyncio
async def test_web_search_ok_with_key(monkeypatch):
    async def fake_snippets(**kwargs):
        assert kwargs["query"] == "pydantic v2"
        assert kwargs["max_results"] == 3
        return "### resultados\n1. **Pydantic**"

    monkeypatch.setattr(web_tools, "fetch_organic_snippets", fake_snippets)
    s = Settings(serpapi_api_key="k", web_search_max_results=5)
    res = await web_tools.run_web_search(s, "pydantic v2", max_results=3)
    assert res["ok"] is True
    assert "Pydantic" in res["content"]


@pytest.mark.asyncio
async def test_web_search_clamps_max_results(monkeypatch):
    seen = {}

    async def fake_snippets(**kwargs):
        seen["max_results"] = kwargs["max_results"]
        return "x"

    monkeypatch.setattr(web_tools, "fetch_organic_snippets", fake_snippets)
    s = Settings(serpapi_api_key="k")
    await web_tools.run_web_search(s, "q", max_results=999)
    assert seen["max_results"] == 10  # clamp a 10


@pytest.mark.asyncio
async def test_web_search_external_failure_is_value(monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("serpapi down")

    monkeypatch.setattr(web_tools, "fetch_organic_snippets", boom)
    s = Settings(serpapi_api_key="k")
    res = await web_tools.run_web_search(s, "q")
    assert res["ok"] is False
    assert res["error"] == "web_search_failed"
    assert "serpapi down" in res["hint"]


@pytest.mark.asyncio
async def test_web_fetch_blocks_ssrf():
    s = Settings()
    res = await web_tools.run_web_fetch(s, "http://localhost:8080/admin")
    assert res["ok"] is False
    assert res["error"] == "url_blocked"


@pytest.mark.asyncio
async def test_web_fetch_ok_for_public_url(monkeypatch):
    async def fake_fetch(url, **kwargs):
        return "conteúdo da página"

    monkeypatch.setattr(web_tools, "fetch_url_plaintext", fake_fetch)
    s = Settings()
    res = await web_tools.run_web_fetch(s, "https://example.com/docs")
    assert res["ok"] is True
    assert "example.com/docs" in res["content"]
    assert "conteúdo da página" in res["content"]


@pytest.mark.asyncio
async def test_web_tools_disabled():
    s = Settings(web_tools_enabled=False)
    r1 = await web_tools.run_web_search(s, "q")
    r2 = await web_tools.run_web_fetch(s, "https://example.com")
    assert r1["error"] == "web_tools_disabled"
    assert r2["error"] == "web_tools_disabled"


# ── Registo no agente Desk ───────────────────────────────────────────────────


def test_desk_tools_include_web_when_enabled():
    from openpolvointeligence.graphs.desk.desk_tool_logic import desk_langchain_tools

    names = {t.name for t in desk_langchain_tools(Settings(web_tools_enabled=True))}
    assert {"web_search", "web_fetch"} <= names


def test_desk_tools_exclude_web_when_disabled():
    from openpolvointeligence.graphs.desk.desk_tool_logic import desk_langchain_tools

    names = {t.name for t in desk_langchain_tools(Settings(web_tools_enabled=False))}
    assert "web_search" not in names and "web_fetch" not in names


@pytest.mark.asyncio
async def test_dispatch_runs_web_tool_server_side(monkeypatch):
    """Tool de web executa server-side; nunca chama o bridge do cliente."""
    from openpolvointeligence.graphs.desk import desk_tool_logic

    async def fake_fetch(url, **kwargs):
        return "página"

    monkeypatch.setattr(web_tools, "fetch_url_plaintext", fake_fetch)

    async def bridge_should_not_be_called(*args, **kwargs):  # pragma: no cover
        raise AssertionError("bridge não deve ser chamado para web tools")

    results = await desk_tool_logic.dispatch_tool_calls(
        Settings(),
        tool_calls=[{"id": "1", "name": "web_fetch", "args": {"url": "https://example.com"}}],
        workspace_path="",
        conversation_id="c1",
        bridge_wait=bridge_should_not_be_called,
    )
    assert len(results) == 1
    assert "página" in results[0]["content"]


# ── Registo no loop de dev ───────────────────────────────────────────────────


def test_dev_loop_schemas_include_web():
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.schemas import (
        READ_TOOLS,
        tool_names,
    )

    assert {"web_search", "web_fetch"} <= READ_TOOLS
    assert {"web_search", "web_fetch"} <= set(tool_names())


@pytest.mark.asyncio
async def test_dev_loop_executes_web_fetch(monkeypatch):
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import tools as loop_tools

    async def fake_fetch(url, **kwargs):
        return "docs"

    monkeypatch.setattr(web_tools, "fetch_url_plaintext", fake_fetch)
    obs, files, ops = await loop_tools.execute_agent_tool(
        Settings(),
        {},
        "web_fetch",
        {"url": "https://example.com"},
        project_files={},
        port=None,
    )
    assert "docs" in obs
    assert ops == []  # read-only, não gera operações de escrita


@pytest.mark.asyncio
async def test_dev_loop_web_search_error_is_observation():
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import tools as loop_tools

    obs, _, ops = await loop_tools.execute_agent_tool(
        Settings(serpapi_api_key=None),
        {},
        "web_search",
        {"query": "q"},
        project_files={},
        port=None,
    )
    assert "web_search" in obs and "SERPAPI_API_KEY" in obs
    assert ops == []
