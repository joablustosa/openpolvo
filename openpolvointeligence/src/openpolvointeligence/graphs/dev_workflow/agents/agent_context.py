"""Contexto partilhado injectado nos agentes LLM."""

from __future__ import annotations

import json
from typing import Any


def _json_block(title: str, data: Any, limit: int = 4000) -> str:
    if not data:
        return ""
    try:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    except TypeError:
        text = str(data)
    return f"\n\n## {title}\n```json\n{text[:limit]}\n```\n"


def build_agent_context_block(state: dict[str, Any]) -> str:
    """Serializa artefactos do gateway/planeamento para prompts downstream."""
    parts = [
        _json_block("execution_plan", state.get("execution_plan")),
        _json_block("requirements", state.get("requirements")),
        _json_block("stack_config", state.get("stack_config")),
        _json_block("impact_analysis", state.get("impact_analysis") or state.get("impact_report")),
        _json_block("openapi_spec", state.get("openapi_spec")),
        _json_block("refactor_plan", state.get("refactor_plan")),
        _json_block("architecture", state.get("architecture")),
        _json_block("project_context", state.get("project_context")),
        _json_block("terminal_errors", state.get("terminal_errors")),
    ]
    return "".join(p for p in parts if p)


def merge_execution_plan_into_targets(
    state: dict[str, Any], plan: dict[str, Any]
) -> dict[str, Any]:
    """Pré-preenche ficheiros do plano gateway quando o architect omite paths."""
    out = dict(plan)
    paths_from_steps: list[str] = []
    exec_plan = state.get("execution_plan")
    if isinstance(exec_plan, dict):
        for step in exec_plan.get("steps") or []:
            if isinstance(step, dict):
                for f in step.get("files") or []:
                    if isinstance(f, str) and f.strip():
                        paths_from_steps.append(f.strip().replace("\\", "/"))
            elif isinstance(step, str) and step.endswith((".tsx", ".ts", ".go", ".py")):
                paths_from_steps.append(step.replace("\\", "/"))

    openapi = state.get("openapi_spec")
    if isinstance(openapi, dict) and openapi.get("paths"):
        paths_from_steps.extend(
            [f"server/routes/{p.strip('/').replace('/', '_')}.ts" for p in openapi["paths"]],
        )

    refactor = state.get("refactor_plan")
    if isinstance(refactor, dict):
        for t in refactor.get("targets") or refactor.get("files") or []:
            if isinstance(t, str):
                paths_from_steps.append(t.replace("\\", "/"))

    if paths_from_steps and not out.get("files_to_create") and not out.get("files_to_modify"):
        out["files_to_create"] = paths_from_steps[:15]
    return out
