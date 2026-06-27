"""Memória Desk MVP — load_context e truncagem (M3)."""

import pytest
from langchain_core.messages import SystemMessage

from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.agent_memory_utils import (
    format_agent_memory_block,
    normalize_agent_memory,
    truncate_memory_for_desk,
)
from openpolvointeligence.graphs.desk.desk_graph import make_load_context_node


def test_normalize_agent_memory_workspace_alias():
    mem = normalize_agent_memory({"global": "prefs", "workspace": "stack notes"})
    assert mem["global"] == "prefs"
    assert mem["builder"] == "stack notes"


def test_truncate_memory_for_desk():
    long = "x" * 5000
    mem = truncate_memory_for_desk({"global": long, "builder": "b"})
    combined = (mem.get("global") or "") + (mem.get("builder") or "")
    assert len(combined) <= 4000


@pytest.mark.asyncio
async def test_load_context_injects_memory_block():
    node = make_load_context_node(get_settings())
    state = {
        "_raw_messages": [{"role": "user", "content": "olá"}],
        "workspace_path": "/tmp/ws",
        "agent_memory": {"global": "Prefere TypeScript", "builder": "Vite + React"},
        "trace": [],
    }
    out = await node(state)
    msgs = out["messages"]
    assert msgs and isinstance(msgs[0], SystemMessage)
    sys = str(msgs[0].content)
    assert "Prefere TypeScript" in sys
    assert "/tmp/ws" in sys
