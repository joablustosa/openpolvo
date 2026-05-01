"""Formata logs do Preview para o contexto do LLM."""

from __future__ import annotations

from typing import Any


def format_explicit_console_logs(entries: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for raw in entries:
        if not isinstance(raw, dict):
            continue
        msg = str(raw.get("message", "")).strip()
        if not msg:
            continue
        lvl = str(raw.get("level", "log")).strip().lower()
        src = str(raw.get("source", "")).strip()
        s = f"[{lvl}] {msg}"
        if src:
            s += f" @ {src[:500]}"
        stk = raw.get("stack")
        if stk:
            s += f"\n{str(stk)[:6000]}"
        lines.append(s)
    return "\n".join(lines)


def merge_preview_console_block(
    _sandbox_project_id: str | None,
    preview_console_logs: list[dict[str, Any]] | None,
    *,
    ring_limit: int = 120,
) -> str | None:
    """Junta linhas enviadas explicitamente neste pedido (``preview_console_logs``).

    O parâmetro ``_sandbox_project_id`` mantém-se por compatibilidade com clientes
    antigos; o buffer no servidor foi removido.
    """
    _ = ring_limit
    if not preview_console_logs:
        return None
    block = format_explicit_console_logs(preview_console_logs)
    if not block.strip():
        return None
    return (
        "### Consola do Preview (envio directo deste turno)\n"
        "O cliente anexou estes eventos da consola; trata como fonte de verdade recente.\n\n"
        + block
    )
