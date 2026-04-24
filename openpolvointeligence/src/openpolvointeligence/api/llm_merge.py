"""Mescla chaves/modelos vindos do pedido HTTP (API Go + SQLite) sobre Settings do ambiente."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings


def merge_llm_from_mapping(base: Settings, data: dict[str, Any]) -> Settings:
    """Actualiza apenas campos LLM presentes e não vazios em data."""
    updates: dict[str, Any] = {}
    if (v := (data.get("openai_api_key") or "").strip()):
        updates["openai_api_key"] = v
    if (v := (data.get("google_api_key") or "").strip()):
        updates["google_api_key"] = v
    if (v := (data.get("openai_model") or "").strip()):
        updates["openai_model"] = v
    if (v := (data.get("google_model") or "").strip()):
        updates["google_model"] = v
    if not updates:
        return base
    return base.model_copy(update=updates)
