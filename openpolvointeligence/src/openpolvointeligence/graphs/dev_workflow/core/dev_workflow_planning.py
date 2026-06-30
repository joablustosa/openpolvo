"""Planeamento por workflow — prompts dev_agent e chamadas LLM."""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import (
    inject_dev_agent_system,
    load_dev_agent_prompt,
)
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.core.workflow_dispatch import workflow_id_for_kind
from openpolvointeligence.graphs.dev_workflow.core.workflow_helpers import (
    PLAN_PROMPT_BY_KIND,
    is_valid_openapi_spec,
    triage_bug_category,
)
from openpolvointeligence.graphs.models import get_chat_model

_logger = logging.getLogger(__name__)


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


def _parse_json_object(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


def _plan_human(state: DevWorkflowState) -> str:
    prompt = str(state.get("user_prompt") or state.get("raw_user_prompt") or "")[:4000]
    digest = str(state.get("project_digest") or "")[:2000]
    kind = str(state.get("request_kind") or "")
    manifest = state.get("file_manifest") or []
    paths = [str(r.get("path", "")) for r in manifest if isinstance(r, dict) and r.get("path")][:30]
    triage_block = ""
    if kind == "bug_fix":
        triage_block = f"\n## Triagem (determinística)\ncategoria: {triage_bug_category(prompt)}\n"
    console = str(state.get("preview_console_block") or state.get("compile_log") or "")[:1500]
    error_block = f"\n## Erros / logs\n{console}\n" if console.strip() else ""
    return (
        f"## Pedido\n{prompt}\n\n"
        f"## Tipo\n{kind}\n"
        f"{triage_block}"
        f"{error_block}\n"
        f"## Digest do projecto\n{digest or '(vazio)'}\n\n"
        f"## Ficheiros conhecidos\n{json.dumps(paths, ensure_ascii=False)}"
    )


async def _run_workflow_plan(
    settings: Settings,
    state: DevWorkflowState,
    *,
    prompt_name: str,
) -> dict[str, Any]:
    kind = str(state.get("request_kind") or "feature")
    workflow_id = workflow_id_for_kind(kind)
    system = inject_dev_agent_system(load_dev_agent_prompt(prompt_name))

    chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
    resp = await chat.ainvoke(
        [SystemMessage(content=system), HumanMessage(content=_plan_human(state))],
    )
    data = _parse_json_object(str(resp.content))

    execution_plan = data.get("execution_plan")
    if not isinstance(execution_plan, dict):
        execution_plan = {
            "workflow": workflow_id,
            "summary": str(data.get("summary") or data.get("rationale") or "")[:500],
            "steps": data.get("steps") if isinstance(data.get("steps"), list) else [],
        }

    if kind == "bug_fix":
        category = triage_bug_category(str(state.get("user_prompt") or ""))
        if isinstance(execution_plan, dict):
            execution_plan.setdefault("triage_category", category)

    patch: dict[str, Any] = {
        "workflow_id": workflow_id,
        "execution_plan": execution_plan,
    }

    impact = data.get("impact_analysis")
    if isinstance(impact, dict):
        patch["impact_analysis"] = impact
        patch["impact_report"] = impact

    openapi = data.get("openapi_spec") or data.get("openapi")
    if isinstance(openapi, dict) and is_valid_openapi_spec(openapi):
        patch["openapi_spec"] = openapi
    elif isinstance(openapi, dict):
        _logger.warning("openapi_spec inválida ignorada (paths ou versão 3.x em falta)")

    refactor = data.get("refactor_plan")
    if isinstance(refactor, dict):
        patch["refactor_plan"] = refactor

    feature_summary = str(
        data.get("feature_summary") or execution_plan.get("summary") or ""
    ).strip()
    if feature_summary:
        patch["feature_summary"] = feature_summary[:400]

    return patch


async def run_new_app_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["new_app"])


async def run_feature_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["feature"])


async def run_debug_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["bug_fix"])


async def run_refactor_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["refactor"])


async def run_api_design_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["api_design"])


async def run_edit_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["edit"])


async def run_delete_plan(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    return await _run_workflow_plan(settings, state, prompt_name=PLAN_PROMPT_BY_KIND["delete"])
