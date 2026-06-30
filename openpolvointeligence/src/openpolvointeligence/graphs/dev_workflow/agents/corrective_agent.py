"""CorrectiveAgent — corrige erros TypeScript pós-escrita."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import load_dev_agent_prompt
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.dev_workflow_self_heal_logic import (
    apply_heal_to_project_files,
)
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.models import get_chat_model


async def run_corrective_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    errors = state.get("error_digest") or []
    files = dict(state.get("project_files") or {})
    pending = list(state.get("pending_writes") or [])
    for w in pending:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            files[str(w["path"])] = str(w.get("content") or "")

    generated = ""
    for w in pending[:5]:
        if isinstance(w, dict) and w.get("content"):
            generated += f"\n### {w.get('path')}\n```\n{w.get('content')}\n```\n"

    ctx = state.get("project_context") or {}
    sys_prompt = load_dev_agent_prompt("corrective_agent")
    human = (
        f"## Erros TypeScript\n{json.dumps(errors[:12], ensure_ascii=False)}\n\n"
        f"## Código gerado\n{generated[:6000]}\n\n"
        f"## Tipos do projecto\n{str(ctx.get('types_summary') or '')[:3000]}\n\n"
        f"Tentativa: {int(state.get('corrective_attempts') or 0) + 1}"
    )
    chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
    resp = await chat.ainvoke([SystemMessage(content=sys_prompt), HumanMessage(content=human)])
    raw = str(resp.content)
    ops: list[dict[str, Any]] = []
    try:
        data = json.loads(raw)
        if isinstance(data.get("operations"), list):
            ops = [o for o in data["operations"] if isinstance(o, dict)]
    except json.JSONDecodeError:
        pass

    valid, _ = validate_polvo_code_operations(ops)
    updated = apply_heal_to_project_files(files, valid)
    attempts = int(state.get("corrective_attempts") or 0) + 1
    new_pending = [
        {"op": o["op"], "path": o["path"], "content": o.get("content")} for o in valid
    ] or pending

    return step_patch(
        state,
        "corrective",
        {
            "pending_writes": new_pending,
            "project_files": updated,
            "corrective_attempts": attempts,
            "polvo_code_ops": valid or state.get("polvo_code_ops"),
        },
        agent="corrective",
    )
