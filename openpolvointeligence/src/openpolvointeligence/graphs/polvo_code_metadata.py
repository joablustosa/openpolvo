"""Geração e validação de `polvo_code_ops` (metadata para o desktop Electron aplicar no disco)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.message_utils import (
    conversation_summary,
    last_user_text,
    tail_messages,
)
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.preview_source_sanitize import sanitize_write_op

MAX_PATH_LEN = 512
MAX_CONTENT_BYTES = 512 * 1024
MAX_OPS = 100

_PROMPT_GENERATE_OPS = (
    Path(__file__).resolve().parent.parent / "prompts" / "polvo_code_generate_ops_system.md"
)


class PolvoCodeOpModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    op: Literal["write", "mkdir"]
    path: str = Field(..., min_length=1)
    content: str | None = None

    @field_validator("path")
    @classmethod
    def normalize_path(cls, v: str) -> str:
        p = str(v).strip().replace("\\", "/").lstrip("/")
        if not p or ".." in p:
            raise ValueError("path inválido")
        if len(p) > MAX_PATH_LEN:
            raise ValueError("path demasiado longo")
        return p

    def to_api_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"op": self.op, "path": self.path}
        if self.op == "write":
            raw = self.content if self.content is not None else ""
            d["content"] = sanitize_write_op(self.path, str(raw))
        return d


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = (
                "\n".join(parts[1:-1])
                if parts[-1].strip().startswith("```")
                else "\n".join(parts[1:])
            )
            return inner.strip()
    return s


def _parse_llm_json_object(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


def validate_polvo_code_operations(raw_ops: list[Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Valida operações vindas do LLM ou de testes."""
    valid: list[dict[str, Any]] = []
    errors: list[str] = []
    if not isinstance(raw_ops, list):
        return valid, ["operations não é uma lista"]
    if len(raw_ops) > MAX_OPS:
        errors.append(f"máximo de {MAX_OPS} operações")
        raw_ops = raw_ops[:MAX_OPS]

    for idx, row in enumerate(raw_ops):
        if not isinstance(row, dict):
            errors.append(f"op[{idx}] inválida")
            continue
        try:
            m = PolvoCodeOpModel.model_validate(row)
        except ValidationError as e:
            errors.append(
                f"op[{idx}]: {e.errors()[0]['msg'] if e.errors() else 'inválida'}"
            )
            continue
        if m.op == "write":
            c = m.content if m.content is not None else ""
            if len(c.encode("utf-8")) > MAX_CONTENT_BYTES:
                errors.append(f"op[{idx}] write: conteúdo > {MAX_CONTENT_BYTES} bytes")
                continue
        valid.append(m.to_api_dict())

    return valid, errors


def _write_paths(ops: list[dict[str, Any]]) -> set[str]:
    return {
        str(o.get("path", "")).replace("\\", "/")
        for o in ops
        if o.get("op") == "write" and o.get("path")
    }


def _infer_create_project(valid_ops: list[dict[str, Any]], raw_flag: bool) -> bool:
    if raw_flag:
        return True
    ps = _write_paths(valid_ops)
    return "package.json" in ps and (
        "src/main.tsx" in ps or "src/main.ts" in ps or "src/main.jsx" in ps
    )


def _infer_npm_install(valid_ops: list[dict[str, Any]], raw_flag: bool) -> bool:
    if raw_flag:
        return True
    ps = _write_paths(valid_ops)
    return "package.json" in ps


def build_polvo_code_ops_metadata(
    wants_apply: bool,
    operations: list[dict[str, Any]],
    validation_errors: list[str],
    *,
    create_project: bool = False,
    project_title: str | None = None,
    npm_install: bool = False,
) -> dict[str, Any]:
    if not wants_apply:
        return {}
    out: dict[str, Any] = {
        "polvo_code_ops": operations,
        "polvo_code_create_project": bool(create_project),
        "polvo_code_project_title": (project_title or "").strip() or None,
        "polvo_code_npm_install": bool(npm_install),
    }
    if validation_errors:
        out["polvo_code_ops_errors"] = validation_errors
    blocked = bool(validation_errors) or not operations
    out["polvo_code_ops_blocked"] = blocked
    out["polvo_code_ops_pending"] = bool(operations and not blocked)
    if out["polvo_code_ops_pending"]:
        out["native_plugin"] = {
            "id": "dev_studio",
            "url": "",
            "label": "Estúdio (preview)",
        }
    return out


def _load_generate_ops_system_prompt() -> str:
    try:
        return _PROMPT_GENERATE_OPS.read_text(encoding="utf-8")
    except OSError:
        return (
            "Responde só JSON com wants_apply, reason, create_project, project_title, "
            "npm_install, operations (write/mkdir, paths POSIX relativos)."
        )


async def generate_polvo_code_operations_for_desktop(
    settings: Settings,
    model_provider: str | None,
    assistant_reply_plain: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Segundo passo LLM: emite JSON com operações de disco (o chat do especialista fica sem código)."""
    summary = conversation_summary(tail_messages(messages))
    user_last = last_user_text(messages)
    sys = _load_generate_ops_system_prompt()
    clip = (assistant_reply_plain or "").strip()[:4000]
    human = f"""## Contexto da conversa (resumo)
{summary}

## Última mensagem do utilizador
{user_last}

## O que o assistente principal acabou de dizer (alinhamento de tom; não copiar código daqui)
{clip}
"""
    chat = get_chat_model(settings, model_provider, json_mode=True, max_tokens=16384)
    resp = await chat.ainvoke(
        [SystemMessage(content=sys), HumanMessage(content=human)],
    )
    return _parse_llm_json_object(str(resp.content))


async def polvo_code_ops_metadata_for_reply(
    settings: Settings,
    model_provider: str | None,
    assistant_text: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    raw = await generate_polvo_code_operations_for_desktop(
        settings, model_provider, assistant_text, messages
    )
    wants = bool(raw.get("wants_apply"))
    ops_raw = raw.get("operations")
    if not isinstance(ops_raw, list):
        ops_raw = []
    valid, verr = validate_polvo_code_operations(ops_raw)
    create_project = _infer_create_project(valid, bool(raw.get("create_project")))
    title = str(raw.get("project_title") or "").strip() or None
    npm_install = _infer_npm_install(valid, bool(raw.get("npm_install")))
    return build_polvo_code_ops_metadata(
        wants,
        valid,
        verr,
        create_project=create_project,
        project_title=title,
        npm_install=npm_install,
    )
