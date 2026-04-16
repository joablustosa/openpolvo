"""LLM para geração de workflows e texto (paridade com o antigo bridge Go)."""

from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model

_WORKFLOW_SYSTEM = """És um especialista em automação web. Responde APENAS com JSON válido, sem markdown nem texto fora do JSON.
O formato obrigatório é:
{"nodes":[{"id":"n1","type":"goto","data":{"url":"https://..."},"position":{"x":0,"y":0}},{"id":"n2","type":"click","data":{"selector":"css..."},"position":{"x":200,"y":0}}],"edges":[{"id":"e1","source":"n1","target":"n2"}]}
Tipos de nó permitidos: goto (data.url), click (data.selector), fill (data.selector + data.value), wait (data.selector), llm (data.prompt).
IDs devem ser únicos. Inclui posições em grelha para o editor visual."""


async def generate_graph_json(
    settings: Settings,
    model_provider: str | None,
    user_request: str,
    recording_hint: str,
) -> str:
    user = user_request
    if recording_hint.strip():
        user += "\n\nContexto adicional (gravação / passos brutos):\n" + recording_hint
    chat = get_chat_model(settings, model_provider, json_mode=False)
    resp = await chat.ainvoke(
        [
            SystemMessage(content=_WORKFLOW_SYSTEM),
            HumanMessage(content=user),
        ],
    )
    return str(resp.content).strip()


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
