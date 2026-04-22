"""Extracção e validação de operações sobre listas de tarefas (metadata para o front)."""

from __future__ import annotations

import json
import uuid
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.message_utils import conversation_summary, tail_messages
from openpolvointeligence.graphs.models import get_chat_model


def _valid_uuid_str(s: str) -> bool:
    try:
        uuid.UUID(str(s).strip())
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def task_list_id_sets(task_lists_raw: list[dict[str, Any]] | None) -> tuple[set[str], set[str]]:
    """IDs de listas e de items conhecidos pelo contexto enviado pela API Go."""
    lids: set[str] = set()
    iids: set[str] = set()
    for row in task_lists_raw or []:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("id", "")).strip()
        if lid and _valid_uuid_str(lid):
            lids.add(lid)
        for it in row.get("items") or []:
            if not isinstance(it, dict):
                continue
            iid = str(it.get("id", "")).strip()
            if iid and _valid_uuid_str(iid):
                iids.add(iid)
    return lids, iids


def format_task_lists_for_prompt(task_lists_raw: list[dict[str, Any]] | None) -> str:
    if not task_lists_raw:
        return ""
    lines: list[str] = []
    for row in task_lists_raw:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("id", "")).strip()
        title = str(row.get("title", "")).strip()
        st = str(row.get("status", "")).strip()
        lines.append(f"- **Lista** `{lid}` — {title} (estado: {st})")
        for it in row.get("items") or []:
            if not isinstance(it, dict):
                continue
            iid = str(it.get("id", "")).strip()
            tit = str(it.get("title", "")).strip()
            ist = str(it.get("status", "")).strip()
            pos = it.get("position", "")
            lines.append(f"  - Item `{iid}` pos {pos} — {tit} ({ist})")
    return "\n".join(lines)


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = "\n".join(parts[1:-1]) if parts[-1].strip().startswith("```") else "\n".join(parts[1:])
            return inner.strip()
    return s


def _parse_ops_extractor(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


def validate_operations(
    operations: list[Any],
    known_list_ids: set[str],
    known_item_ids: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Filtra operações a IDs conhecidos; create_list não precisa de list_id existente."""
    valid: list[dict[str, Any]] = []
    errors: list[str] = []
    if not isinstance(operations, list):
        return valid, ["operations não é uma lista"]

    for idx, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append(f"op[{idx}] inválida")
            continue
        name = str(op.get("op", "")).strip()
        if not name:
            errors.append(f"op[{idx}] sem campo op")
            continue
        o = dict(op)
        o["op"] = name

        if name == "create_list":
            title = str(o.get("title", "")).strip()
            if not title:
                errors.append("create_list sem title")
                continue
            valid.append(o)
            continue

        if name == "delete_lists":
            ids = o.get("ids")
            if not isinstance(ids, list) or not ids:
                errors.append("delete_lists sem ids")
                continue
            filt: list[str] = []
            for x in ids:
                sid = str(x).strip()
                if sid in known_list_ids:
                    filt.append(sid)
                else:
                    errors.append(f"delete_lists: id desconhecido {sid}")
            if not filt:
                continue
            o["ids"] = filt
            valid.append(o)
            continue

        lid = str(o.get("list_id", "")).strip()
        if name in ("patch_list_title", "append_items", "patch_item", "delete_item", "delete_list", "run_list"):
            if lid not in known_list_ids:
                errors.append(f"{name}: list_id desconhecido ou inválido")
                continue

        if name == "patch_list_title":
            if not str(o.get("title", "")).strip():
                errors.append("patch_list_title sem title")
                continue
            valid.append(o)
            continue

        if name == "append_items":
            items = o.get("items")
            if not isinstance(items, list) or not items:
                errors.append("append_items sem items")
                continue
            valid.append(o)
            continue

        if name in ("patch_item", "delete_item"):
            iid = str(o.get("item_id", "")).strip()
            if iid not in known_item_ids:
                errors.append(f"{name}: item_id desconhecido")
                continue
            valid.append(o)
            continue

        if name == "delete_list":
            valid.append(o)
            continue

        if name == "run_list":
            valid.append(o)
            continue

        errors.append(f"op desconhecida: {name}")

    return valid, errors


def build_task_list_ops_metadata(
    wants: bool,
    operations: list[dict[str, Any]],
    validation_errors: list[str],
) -> dict[str, Any]:
    if not wants:
        return {}
    out: dict[str, Any] = {"task_list_ops": operations}
    if validation_errors:
        out["task_list_ops_errors"] = validation_errors
    blocked = bool(validation_errors) or not operations
    out["task_list_ops_blocked"] = blocked
    out["task_list_ops_pending"] = bool(operations and not blocked)
    return out


async def extract_task_list_operations(
    settings: Settings,
    model_provider: str | None,
    assistant_markdown: str,
    messages: list[dict[str, Any]],
    task_lists_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """LLM extrai JSON com wants_mutations + operations alinhadas ao pedido do utilizador."""
    known_l, known_i = task_list_id_sets(task_lists_raw)
    ctx_json = json.dumps(task_lists_raw or [], ensure_ascii=False)
    summary = conversation_summary(tail_messages(messages))
    clip = (assistant_markdown or "")[:12000]
    sys = f"""És um extrator para a app Open Polvo (listas de tarefas). Responde APENAS com um único objeto JSON (sem markdown).

Chaves obrigatórias:
- "wants_mutations": boolean — true se o utilizador pediu explicitamente para **criar, alterar, apagar, adicionar tarefas, renomear listas, executar/processar a lista** na aplicação. false se só pediu conselhos, priorização teórica ou contagem/resumo sem pedir alteração persistida.
- "operations": array de operações. Cada operação tem "op" e campos conforme o tipo.

Tipos de operação permitidos (usa só list_id/item_id que existam no contexto JSON abaixo, excepto create_list):
- {{"op":"create_list","title":"...","items":[{{"title":"...","description":"..."}}]}}
- {{"op":"patch_list_title","list_id":"UUID","title":"..."}}
- {{"op":"append_items","list_id":"UUID","items":[{{"title":"...","description":"..."}}]}}
- {{"op":"patch_item","list_id":"UUID","item_id":"UUID","title":"...","description":"...","position":0}} — omite chaves que não devam mudar (podes usar null para limpar descrição se o utilizador pediu).
- {{"op":"delete_item","list_id":"UUID","item_id":"UUID"}}
- {{"op":"delete_list","list_id":"UUID"}}
- {{"op":"delete_lists","ids":["UUID",...]}}
- {{"op":"run_list","list_id":"UUID"}} — quando pedem para executar/processar a lista com o agente.

Contexto actual das listas (JSON):
{ctx_json}

Resumo do histórico: {summary}

Resposta do assistente a interpretar (para alinhar operações ao que foi dito ao utilizador):
---
{clip}
---
Não inventes UUIDs que não estejam no contexto (excepto create_list que não usa list_id)."""
    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke(
        [SystemMessage(content=sys), HumanMessage(content="Extrai o JSON.")],
    )
    return _parse_ops_extractor(str(resp.content))


async def task_list_ops_metadata_for_reply(
    settings: Settings,
    model_provider: str | None,
    assistant_text: str,
    messages: list[dict[str, Any]],
    task_lists_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    raw = await extract_task_list_operations(
        settings, model_provider, assistant_text, messages, task_lists_raw,
    )
    wants = bool(raw.get("wants_mutations"))
    ops_raw = raw.get("operations")
    if not isinstance(ops_raw, list):
        ops_raw = []
    known_l, known_i = task_list_id_sets(task_lists_raw)
    valid, verr = validate_operations(ops_raw, known_l, known_i)
    return build_task_list_ops_metadata(wants, valid, verr)
