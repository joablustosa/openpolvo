"""Semantic Engine facade sobre code_rag."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
    run_code_rag_for_router,
)
from openpolvointeligence.graphs.dev_workflow.engines.symbols.graph import (
    build_symbol_graph_from_state,
)


async def semantic_enrich(
    settings: Any,
    state: dict[str, Any],
    *,
    phase: str = "router",
) -> dict[str, Any]:
    """Enriquece estado com RAG e symbol graph."""
    _ = phase
    patch = await run_code_rag_for_router(settings, state)
    sg = build_symbol_graph_from_state({**state, **patch})
    patch["symbol_graph"] = sg.to_dict()
    return patch
