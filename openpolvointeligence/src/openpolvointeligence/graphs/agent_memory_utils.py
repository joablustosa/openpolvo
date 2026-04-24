"""Memória híbrida: bloco de prompt + patch sugerido para persistência (SQLite via API Go)."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.graphs.message_utils import conversation_summary, last_user_text, tail_messages
from openpolvointeligence.graphs.models import get_chat_model

_MAX_GLOBAL = 6000
_MAX_BUILDER = 4000

_MEMORY_KEYWORDS = (
    "lembr",
    "memoriz",
    "guarda que",
    "não esqueças",
    "nao esquecas",
    "anota que",
    "regista que",
)


def normalize_agent_memory(raw: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {"global": "", "builder": ""}
    g = str(raw.get("global") or raw.get("global_memory") or "").strip()
    b = str(raw.get("builder") or raw.get("builder_memory") or "").strip()
    return {"global": g[:_MAX_GLOBAL], "builder": b[:_MAX_BUILDER]}


def format_agent_memory_block(mem: dict[str, str] | None) -> str:
    m = mem or {}
    g = str(m.get("global") or "").strip()
    b = str(m.get("builder") or "").strip()
    if not g and not b:
        return ""
    parts = ["## Memória persistente da conversa (Open Polvo)"]
    if g:
        parts.append("### Escopo geral\n" + g)
    if b:
        parts.append("### Últimas convenções do Builder / projecto\n" + b)
    parts.append(
        "_Usa esta memória para consistência; não contradigas factos aqui descritos sem confirmar com o utilizador._"
    )
    return "\n\n".join(parts)


def should_refresh_memory_facts(msgs: list[dict[str, Any]]) -> bool:
    """Heurística: de N em N mensagens ou pedido explícito para lembrar."""
    n = len(msgs)
    if n > 0 and n % 10 == 0:
        return True
    last = last_user_text(msgs, 1200).lower()
    return any(k in last for k in _MEMORY_KEYWORDS)


def _clip(s: str, max_len: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= max_len else s[: max_len - 1] + "…"


async def merge_global_memory_llm(
    settings: Any,
    model_provider: str | None,
    msgs: list[dict[str, Any]],
    previous_global: str,
) -> str:
    """Funde factos estáveis num único texto (substituição suave do global)."""
    capped = tail_messages(msgs, 30)
    summary = conversation_summary(capped, last_n=12)
    sys = (
        "És um compressor de memória para um assistente. Recebes o resumo recente do chat e a memória global "
        "anterior. Produz APENAS um JSON válido: {\"global_memory\": \"...\"}.\n"
        "A string `global_memory` deve ter no máximo 4500 caracteres, em português europeu, estilo bullet ou frases curtas: "
        "preferências do utilizador, nomes, stack, URLs, decisões de produto. Omite trivialidades e mensagens de saudação. "
        "Se a memória anterior ainda for válida, funde-a com novidades; remove contradições antigas."
    )
    user = json.dumps(
        {"previous_global": previous_global[:_MAX_GLOBAL], "recent_transcript": summary},
        ensure_ascii=False,
    )
    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke([SystemMessage(content=sys), HumanMessage(content=user)])
    raw = str(resp.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\"global_memory\"[\s\S]*\}", raw)
        if not m:
            return _clip(previous_global, _MAX_GLOBAL)
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return _clip(previous_global, _MAX_GLOBAL)
    if not isinstance(data, dict):
        return _clip(previous_global, _MAX_GLOBAL)
    out = str(data.get("global_memory") or "").strip()
    if not out:
        return _clip(previous_global, _MAX_GLOBAL)
    return _clip(out, _MAX_GLOBAL)


def builder_notes_from_artifact(artifact: dict[str, Any]) -> str:
    title = str(artifact.get("title") or "").strip()
    pt = str(artifact.get("project_type") or "").strip()
    entry = str(artifact.get("entry_file") or "").strip()
    fw = str(artifact.get("framework") or "").strip()
    lines = [f"Última app gerada: {title or '—'}", f"project_type: {pt or '—'}", f"entry_file: {entry or '—'}"]
    if fw:
        lines.append(f"framework: {fw}")
    return "\n".join(lines)[:_MAX_BUILDER]


async def finalize_reply_metadata(
    settings: Any,
    model_provider: str | None,
    messages: list[dict[str, Any]],
    agent_memory_in: dict[str, Any] | None,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Acrescenta `agent_memory_patch` ao metadata quando aplicável."""
    out = dict(meta or {})
    prev = normalize_agent_memory(agent_memory_in)
    new_global: str | None = None
    if should_refresh_memory_facts(messages):
        try:
            new_global = await merge_global_memory_llm(
                settings, model_provider, messages, prev["global"],
            )
        except Exception:
            new_global = None
    patch = build_agent_memory_patch(meta=out, new_global=new_global)
    if patch:
        out["agent_memory_patch"] = patch
    return out


def build_agent_memory_patch(
    *,
    meta: dict[str, Any],
    new_global: str | None,
) -> dict[str, str] | None:
    """Monta patch mínimo para o cliente Go persistir (global e/ou builder)."""
    out: dict[str, str] = {}
    art = meta.get("builder")
    if isinstance(art, dict) and art.get("files"):
        bn = builder_notes_from_artifact(art)
        if bn.strip():
            out["builder"] = bn
    if new_global is not None and new_global.strip():
        out["global"] = new_global.strip()
    return out or None
