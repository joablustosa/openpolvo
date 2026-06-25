"""Estado tipado do grafo de resposta rica em conversa."""

from __future__ import annotations

from typing import Any, TypedDict


class ConversationReplyState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str | None
    user_query: str
    conv_summary: str
    enriched_brief: dict[str, Any]
    research_dossier: str
    synthesis_text: str
    rich_blocks: list[dict[str, Any]]
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
