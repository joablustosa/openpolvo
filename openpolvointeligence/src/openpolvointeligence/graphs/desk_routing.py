"""Routing Desk vs Zé Polvinho (M1 CORE-4.1)."""

from __future__ import annotations

from typing import Any


def should_use_desk_graph(desk_context: dict[str, Any] | None) -> bool:
    if not desk_context or not isinstance(desk_context, dict):
        return False
    mode = str(desk_context.get("mode") or "").strip().lower()
    if mode not in ("agent", "code"):
        return False
    return True


def desk_workspace_path(desk_context: dict[str, Any] | None) -> str:
    if not desk_context:
        return ""
    return str(desk_context.get("workspace_path") or "").strip()


def desk_conversation_id(desk_context: dict[str, Any] | None) -> str:
    if not desk_context:
        return ""
    return str(desk_context.get("conversation_id") or "").strip()
