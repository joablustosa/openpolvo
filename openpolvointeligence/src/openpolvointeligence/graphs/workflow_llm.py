"""LLM para geração de texto simples (nós llm no runner de workflows)."""

from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model


async def generate_text(
    settings: Settings,
    model_provider: str | None,
    system: str,
    user: str,
) -> str:
    chat = get_chat_model(settings, model_provider, json_mode=False)
    resp = await chat.ainvoke(
        [
            SystemMessage(content=system),
            HumanMessage(content=user),
        ],
    )
    return str(resp.content).strip()
