"""Fallback determinístico (sem LLM) quando o workflow falha em projectos novos."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import has_existing_app_in_state
from openpolvointeligence.graphs.dev_workflow.scaffold_ops import merge_scaffold_operations


def _prompt_text(state: dict[str, Any]) -> str:
    return str(
        state.get("user_prompt")
        or state.get("enriched_prompt")
        or ""
    ).strip()


def _title_from_state(state: dict[str, Any]) -> str | None:
    for key in ("feature_summary", "polvo_code_project_title", "project_title"):
        val = str(state.get(key) or "").strip()
        if val:
            return val[:80]
    prompt = _prompt_text(state)
    if prompt:
        return prompt[:80]
    return None


def _stack_for_fallback(state: dict[str, Any]) -> str:
    plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}
    stack = str(plan.get("stack") or state.get("stack_hint") or "").strip().lower()
    if stack in ("vite-react", "fullstack-mixed", "fullstack-react-go"):
        return stack
    prompt = _prompt_text(state).lower()
    if any(k in prompt for k in ("backend", "api", "go ", "fullstack", "full stack")):
        return "fullstack-react-go"
    return "vite-react"


def can_scaffold_fallback(state: dict[str, Any]) -> bool:
    if has_existing_app_in_state(state):
        return False
    kind = str(state.get("request_kind") or "")
    if kind != "new_app":
        return False
    return True


def build_scaffold_fallback_patch(
    settings: Settings,  # noqa: ARG001 — reservado para flags futuras
    state: dict[str, Any],
    *,
    llm_error: str = "",
) -> dict[str, Any]:
    """Gera scaffold Vite+React completo quando o LLM não responde."""
    title = _title_from_state(state)
    stack = _stack_for_fallback(state)
    design_tokens = {"layout_shell": "marketing", "mode": "light", "accent": "blue"}
    ops = merge_scaffold_operations(
        [],
        create_project=True,
        stack=stack,
        project_title=title,
        design_tokens=design_tokens,
    )
    valid, verr = validate_polvo_code_operations(ops)
    has_ws = bool(str(state.get("workspace_id") or state.get("workspace_path") or "").strip())
    meta = build_polvo_code_ops_metadata(
        bool(valid),
        valid,
        verr,
        create_project=True,
        project_title=title,
        npm_install=True,
        has_workspace=has_ws,
        stack=stack,
        design_tokens=design_tokens,
    )
    meta["scaffold_fallback"] = True
    if llm_error:
        meta["llm_fallback_reason"] = llm_error[:300]

    short_err = llm_error[:120] + ("…" if len(llm_error) > 120 else "")
    assistant = (
        "O modelo de IA não respondeu (cota, chave ou ligação). "
        "Apliquei o **scaffold Vite + React** padrão com layout de marketing — "
        "pode pedir ajustes de copy, cores ou secções depois."
    )
    if short_err:
        assistant += f"\n\n_Detalhe: {short_err}_"

    return {
        "assistant_text": assistant,
        "metadata": meta,
        "polvo_code_ops": meta.get("polvo_code_ops") or valid,
        "pending_writes": valid,
        "scaffold_fallback": True,
    }
