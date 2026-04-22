"""Extracção de operações sobre tarefas agendadas a partir da resposta do especialista."""

from __future__ import annotations

import json
import uuid
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.message_utils import conversation_summary, tail_messages
from openpolvointeligence.graphs.models import get_chat_model

_VALID_TASK_TYPES = {"agent_prompt", "run_task_list"}
_VALID_OPS = {"create", "update", "delete", "toggle"}


def _valid_uuid(s: str) -> bool:
    try:
        uuid.UUID(str(s).strip())
    except (ValueError, TypeError):
        return False
    return True


def _strip_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = "\n".join(parts[1:-1]) if parts[-1].strip().startswith("```") else "\n".join(parts[1:])
            return inner.strip()
    return s


def _known_ids(sched_raw: list[dict[str, Any]] | None) -> set[str]:
    out: set[str] = set()
    for row in sched_raw or []:
        if isinstance(row, dict):
            sid = str(row.get("id", "")).strip()
            if sid and _valid_uuid(sid):
                out.add(sid)
    return out


def validate_sched_ops(
    operations: list[Any],
    known_ids: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    valid: list[dict[str, Any]] = []
    errors: list[str] = []
    if not isinstance(operations, list):
        return valid, ["operations não é uma lista"]

    for idx, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append(f"op[{idx}] não é objecto")
            continue
        name = str(op.get("op", "")).strip()
        if name not in _VALID_OPS:
            errors.append(f"op desconhecida: {name!r}")
            continue
        o = dict(op)
        o["op"] = name

        if name == "create":
            task_type = str(o.get("task_type", "")).strip()
            if task_type not in _VALID_TASK_TYPES:
                errors.append(f"create: task_type inválido {task_type!r}")
                continue
            if not str(o.get("name", "")).strip():
                errors.append("create: name obrigatório")
                continue
            if not str(o.get("cron_expr", "")).strip():
                errors.append("create: cron_expr obrigatório")
                continue
            # garante payload como dict
            if not isinstance(o.get("payload"), dict):
                o["payload"] = {}
            if not o.get("timezone"):
                o["timezone"] = "America/Sao_Paulo"
            valid.append(o)
            continue

        if name in ("update", "delete", "toggle"):
            sid = str(o.get("id", "")).strip()
            if not _valid_uuid(sid):
                errors.append(f"{name}: id UUID inválido")
                continue
            if sid not in known_ids:
                errors.append(f"{name}: id desconhecido {sid}")
                continue
            valid.append(o)
            continue

    return valid, errors


async def extract_sched_ops(
    settings: Settings,
    model_provider: str | None,
    assistant_text: str,
    messages: list[dict[str, Any]],
    sched_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    known = _known_ids(sched_raw)
    ctx_json = json.dumps(sched_raw or [], ensure_ascii=False)
    summary = conversation_summary(tail_messages(messages))
    clip = (assistant_text or "")[:10000]

    sys = f"""És um extrator para o sistema de tarefas agendadas do Open Polvo. Responde APENAS com um JSON (sem markdown).

Chaves obrigatórias:
- "wants_mutations": boolean — true se o utilizador pediu **criar, editar, apagar, activar ou desactivar** uma tarefa agendada; false se só pediu informação, listagem ou o agente ainda não propôs nada concreto.
- "operations": array de operações.

Tipos de operação:
- {{"op":"create","name":"...","description":"...","task_type":"agent_prompt|run_task_list","cron_expr":"0 20 * * *","timezone":"America/Sao_Paulo","active":true,"payload":{{"prompt":"...","send_email":true,"email_subject":"...","include_tasks":true,"include_finance":true}}}}
- {{"op":"create","name":"...","task_type":"run_task_list","cron_expr":"...","timezone":"...","active":true,"payload":{{"task_list_id":"UUID","task_list_name":"..."}}}}
- {{"op":"update","id":"UUID-existente","name":"...","cron_expr":"...","active":true,"payload":{{...}}}}
- {{"op":"delete","id":"UUID-existente"}}
- {{"op":"toggle","id":"UUID-existente","active":true|false}}

Regras:
- Para operações que referenciam IDs existentes (update/delete/toggle), usa APENAS IDs da lista abaixo.
- Para "create", não precisas de ID (é gerado pelo servidor).
- O campo "payload" para agent_prompt deve ter "prompt" (string com o prompt a executar), "send_email" (bool), opcionalmente "email_subject" e "include_tasks"/"include_finance".
- Nunca inventes IDs.

Automações existentes (JSON):
{ctx_json}

Resumo da conversa: {summary}

Resposta do especialista de agendamento a interpretar:
---
{clip}
---"""

    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke([SystemMessage(content=sys), HumanMessage(content="Extrai o JSON.")])
    raw = _strip_fence(str(resp.content))
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


async def sched_ops_metadata_for_reply(
    settings: Settings,
    model_provider: str | None,
    assistant_text: str,
    messages: list[dict[str, Any]],
    sched_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    raw = await extract_sched_ops(settings, model_provider, assistant_text, messages, sched_raw)
    wants = bool(raw.get("wants_mutations"))
    ops_raw = raw.get("operations")
    if not isinstance(ops_raw, list):
        ops_raw = []
    known = _known_ids(sched_raw)
    valid, verr = validate_sched_ops(ops_raw, known)
    if not wants:
        return {}
    out: dict[str, Any] = {"scheduled_task_ops": valid}
    if verr:
        out["scheduled_task_ops_errors"] = verr
    out["scheduled_task_ops_blocked"] = bool(verr) or not valid
    out["scheduled_task_ops_pending"] = bool(valid and not (bool(verr) or not valid))
    return out


def format_sched_tasks_for_prompt(sched_raw: list[dict[str, Any]] | None) -> str:
    if not sched_raw:
        return ""
    lines: list[str] = []
    for row in sched_raw:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id", "")).strip()
        name = str(row.get("name", "")).strip()
        tt = str(row.get("task_type", "")).strip()
        cron = str(row.get("cron_expr", "")).strip()
        tz = str(row.get("timezone", "")).strip()
        active = bool(row.get("active", True))
        status = "✓ activa" if active else "⏸ pausada"
        lines.append(f"- `{sid}` **{name}** ({tt}) — `{cron}` ({tz}) [{status}]")
    return "\n".join(lines)
