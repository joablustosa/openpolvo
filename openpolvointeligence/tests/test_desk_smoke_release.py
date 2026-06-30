"""Smoke tests release Desk MVP v0.1 (M5 REL-1) — sem browser."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import pytest

from openpolvointeligence.graphs.desk.desk_routing import should_use_desk_graph
from openpolvointeligence.graphs.desk.desk_tool_logic import execute_tool_local
from openpolvointeligence.core.config import Settings


def test_desk_routing_smoke():
    assert should_use_desk_graph({"mode": "agent"}) is True
    assert should_use_desk_graph({"mode": "code"}) is True
    assert should_use_desk_graph(None) is False
    assert should_use_desk_graph({"mode": "flow"}) is False


def test_tool_filesystem_list_smoke(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.ts").write_text("x", encoding="utf-8")
    r = execute_tool_local(
        Settings(),
        tool_name="filesystem_list",
        args={"rel_path": "src"},
        workspace_path=str(tmp_path),
    )
    assert r["ok"] is True
    names = {e["name"] for e in r.get("entries") or []}
    assert "main.ts" in names


def test_tool_terminal_echo_smoke(tmp_path):
    r = execute_tool_local(
        Settings(),
        tool_name="terminal_run",
        args={"command": "echo ok"},
        workspace_path=str(tmp_path),
    )
    assert r.get("ok") is True
    assert "ok" in str(r.get("output", ""))


def _live_base(name: str, default: str) -> str:
    return os.environ.get(name, default).rstrip("/")


@pytest.mark.integration
def test_live_three_stacks_health():
    """Requer backend + intelligence a correr (opcional na CI)."""
    backend = _live_base("DESK_SMOKE_BACKEND_URL", "http://127.0.0.1:8081")
    intel = _live_base("DESK_SMOKE_INTEL_URL", "http://127.0.0.1:8090")
    try:
        with httpx.Client(timeout=5.0) as client:
            rb = client.get(f"{backend}/healthz")
            if rb.status_code == 404:
                pytest.skip("backend not running")
            rb.raise_for_status()
            ri = client.get(f"{intel}/readyz")
            if ri.status_code >= 500:
                pytest.skip("intelligence not ready")
            ri.raise_for_status()
    except httpx.ConnectError:
        pytest.skip("stacks not running")


@pytest.mark.integration
def test_live_ollama_tags():
    ollama = _live_base("DESK_SMOKE_OLLAMA_URL", "http://127.0.0.1:11434")
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{ollama}/api/tags")
            if r.status_code != 200:
                pytest.skip("ollama not running")
            data = r.json()
            assert "models" in data
    except httpx.ConnectError:
        pytest.skip("ollama not running")


@pytest.mark.integration
def test_live_desk_reply_stream_events():
    """POST /v1/reply/stream com desk_context — valida eventos SSE mínimos."""
    intel = _live_base("DESK_SMOKE_INTEL_URL", "http://127.0.0.1:8090")
    key = os.environ.get("POLVO_INTERNAL_KEY", os.environ.get("DESK_SMOKE_INTERNAL_KEY", ""))
    if not key.strip():
        pytest.skip("POLVO_INTERNAL_KEY not set")
    body = {
        "messages": [{"role": "user", "content": "Responde apenas: pong"}],
        "model_provider": "ollama",
        "desk_context": {
            "mode": "agent",
            "workspace_path": os.getcwd(),
            "conversation_id": "smoke-1",
        },
    }
    headers = {"X-Open-Polvo-Internal-Key": key.strip(), "Content-Type": "application/json"}
    events: list[dict[str, Any]] = []
    with httpx.Client(timeout=120.0) as client:
        try:
            with client.stream(
                "POST", f"{intel}/v1/reply/stream", json=body, headers=headers
            ) as resp:
                if resp.status_code == 503:
                    pytest.skip("intelligence not configured for LLM")
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload:
                        continue
                    events.append(json.loads(payload))
                    if any(e.get("type") == "done" for e in events):
                        break
        except httpx.ConnectError:
            pytest.skip("intelligence not running")
    types = {e.get("type") for e in events}
    assert "done" in types or "error" in types
    if "agent_event" in types:
        assert any(e.get("event_type") for e in events if e.get("type") == "agent_event")
