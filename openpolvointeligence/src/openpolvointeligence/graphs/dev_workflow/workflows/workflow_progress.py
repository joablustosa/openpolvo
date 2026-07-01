"""Emissão de progresso do workflow para o cliente (SSE) durante execução dos nós."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import get_terminal_port


async def emit_workflow_step_start(step: str) -> None:
    """Notifica o gateway para emitir progresso assim que um passo começa (não só ao terminar)."""
    key = str(step or "").strip()
    if not key:
        return
    port = get_terminal_port()
    if port and port.emit:
        await port.emit("workflow_step", {"step": key})
