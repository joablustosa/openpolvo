"""LangGraph checkpointer."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

_logger = logging.getLogger(__name__)
_CHECKPOINTER: Any = None


def get_checkpointer(settings: Any) -> Any | None:
    """Retorna AsyncSqliteSaver quando checkpoint enabled."""
    global _CHECKPOINTER
    if not getattr(settings, "dev_workflow_checkpoint_enabled", False):
        return None
    if _CHECKPOINTER is not None:
        return _CHECKPOINTER
    try:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        db_path = Path(
            getattr(settings, "dev_workflow_checkpoint_path", "")
            or ".dev_workflow_checkpoints.sqlite"
        )
        _CHECKPOINTER = AsyncSqliteSaver.from_conn_string(str(db_path))
        _logger.info("Dev workflow checkpointer: %s", db_path)
        return _CHECKPOINTER
    except Exception as exc:
        _logger.warning("Checkpointer unavailable: %s", exc)
        return None


def compile_with_checkpoint(graph: Any, settings: Any) -> Any:
    cp = get_checkpointer(settings)
    if cp is None:
        return graph.compile()
    return graph.compile(checkpointer=cp)
