"""Testes de progresso em tempo real do workflow."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from openpolvointeligence.graphs.dev_workflow.workflows.workflow_progress import (
    emit_workflow_step_start,
)


@pytest.mark.asyncio
async def test_emit_workflow_step_start_uses_port_emit():
    emit = AsyncMock()
    port = AsyncMock()
    port.emit = emit
    from openpolvointeligence.graphs.dev_workflow.tools import terminal_port as tp

    token = tp.set_terminal_port(port)
    try:
        await emit_workflow_step_start("requirements")
    finally:
        tp.reset_terminal_port(token)
    emit.assert_awaited_once_with("workflow_step", {"step": "requirements"})
