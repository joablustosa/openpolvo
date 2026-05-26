"""Self-Healing — LLM gera patches de correcção após erro de compilação."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow_codegen_logic import resolve_codegen_operations
from openpolvointeligence.graphs.layout_scaffold_heal_logic import (
    build_layout_scaffold_heal_ops,
)
from openpolvointeligence.graphs.dev_workflow_compiler_logic import (
    build_self_heal_human_message,
    merge_compile_sources,
    parse_compile_output,
    pick_primary_error_file,
)
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)

_PROMPT = Path(__file__).resolve().parent.parent / "prompts" / "dev_workflow_compiler_system.md"


def _load_prompt() -> str:
    return _PROMPT.read_text(encoding="utf-8")


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


def apply_heal_to_project_files(
    project_files: dict[str, str],
    ops: list[dict[str, Any]],
) -> dict[str, str]:
    """Aplica writes resultantes dos patches ao mapa virtual."""
    updated = dict(project_files)
    for op in ops:
        if op.get("op") == "write" and op.get("path"):
            path = str(op["path"]).replace("\\", "/")
            updated[path] = str(op.get("content") or "")
    return updated


async def run_self_heal(
    settings: Settings,
    model_provider: str | None,
    *,
    user_prompt: str,
    compile_log: str,
    error_digest: list[dict[str, Any]],
    project_files: dict[str, str],
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Invoca correcção determinística de layout (se aplicável) ou LLM Self-Healing.
    """
    deterministic = build_layout_scaffold_heal_ops(compile_log)
    if deterministic:
        valid, verr = validate_polvo_code_operations(deterministic)
        updated_files = apply_heal_to_project_files(project_files, valid)
        meta = build_polvo_code_ops_metadata(
            bool(valid),
            valid,
            verr,
            create_project=False,
            npm_install=False,
        )
        meta["dev_workflow"] = {
            "self_heal": True,
            "root_cause": "layout_scaffold",
            "heal_summary": "Layout scaffold restaurado (AppShell, Navbar, Sidebar).",
        }
        return {
            "polvo_code_ops": valid,
            "pending_writes": [
                {"op": o["op"], "path": o["path"], "content": o.get("content")}
                for o in valid
            ],
            "project_files": updated_files,
            "heal_summary": meta["dev_workflow"]["heal_summary"],
            "metadata": meta,
            "heal_errors": verr,
        }

    primary = pick_primary_error_file(error_digest, project_files)
    human = build_self_heal_human_message(
        error_digest=error_digest,
        compile_log=compile_log,
        primary_file=primary,
        project_files=project_files,
        plan=plan,
        user_prompt=user_prompt,
    )
    chat = get_chat_model(settings, model_provider, json_mode=True, max_tokens=8192)
    resp = await chat.ainvoke(
        [SystemMessage(content=_load_prompt()), HumanMessage(content=human)],
    )
    data = _parse_json_object(str(resp.content))
    ops_raw = data.get("operations")
    if not isinstance(ops_raw, list):
        ops_raw = []

    heal_plan = {
        "files_to_modify": [primary] if primary else [],
        "files_to_create": [],
        "targets": [primary] if primary else [],
    }
    resolved, resolve_errs = resolve_codegen_operations(
        ops_raw,
        project_files,
        heal_plan,
    )
    valid, verr = validate_polvo_code_operations(resolved)
    all_errs = verr + resolve_errs

    updated_files = apply_heal_to_project_files(project_files, valid)
    meta = build_polvo_code_ops_metadata(
        bool(valid),
        valid,
        all_errs,
        create_project=False,
        npm_install=any(str(o.get("path", "")).endswith("package.json") for o in valid),
    )
    meta["dev_workflow"] = {
        "self_heal": True,
        "root_cause": str(data.get("root_cause") or "")[:40],
        "heal_summary": str(data.get("heal_summary") or "")[:300],
    }

    return {
        "polvo_code_ops": valid,
        "pending_writes": [
            {"op": o["op"], "path": o["path"], "content": o.get("content")}
            for o in valid
        ],
        "project_files": updated_files,
        "heal_summary": str(data.get("heal_summary") or "").strip(),
        "metadata": meta,
        "heal_errors": all_errs,
    }


async def run_dev_workflow_self_heal(
    settings: Settings,
    model_provider: str | None,
    *,
    user_prompt: str = "",
    compile_log: str | None = None,
    preview_console_block: str | None = None,
    preview_console_logs: list[dict[str, Any]] | None = None,
    project_files: dict[str, str] | None = None,
    plan: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Entry point API: recebe log do frontend WebContainer e devolve ops corrigidas."""
    merged = merge_compile_sources(preview_console_block, compile_log, preview_console_logs)
    ok, error_digest = parse_compile_output(merged)
    if ok or not error_digest:
        return (
            "Nenhum erro de compilação detectado no log enviado.",
            {"dev_workflow": {"self_heal": False, "compile_ok": True}},
        )

    files = dict(project_files or {})
    result = await run_self_heal(
        settings,
        model_provider,
        user_prompt=user_prompt or "Corrigir erros de build do preview",
        compile_log=merged,
        error_digest=error_digest,
        project_files=files,
        plan=plan,
    )
    summary = result.get("heal_summary") or "Apliquei correcções automáticas ao preview."
    meta = result.get("metadata") or {}
    meta.setdefault("routed_intent", "polvo_code_builder")
    meta["dev_studio_context"] = {
        "project_files": result.get("project_files") or files,
        "project_file_tree": sorted((result.get("project_files") or files).keys()),
    }
    if result.get("heal_errors"):
        meta["dev_workflow_heal_errors"] = result["heal_errors"][:10]
    return str(summary), meta
