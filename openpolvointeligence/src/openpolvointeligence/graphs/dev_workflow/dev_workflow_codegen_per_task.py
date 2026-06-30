"""Codegen por build_task — uma chamada LLM por ficheiro para completude."""

from __future__ import annotations

import json
from typing import Any, Callable

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_codegen_logic import (
    build_codegen_file_excerpts,
    resolve_codegen_operations,
)
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.models import get_chat_model

MAX_MISSING_PATH_RETRIES = 2


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def plan_paths_from_plan(plan: dict[str, Any]) -> set[str]:
    return {
        _norm_path(str(p))
        for p in (plan.get("files_to_create") or []) + (plan.get("files_to_modify") or [])
        if p
    }


def op_paths_from_ops(ops: list[dict[str, Any]]) -> set[str]:
    return {_norm_path(str(o.get("path") or "")) for o in ops if o.get("path")}


def _apply_writes_to_virtual_files(
    project_files: dict[str, str],
    ops: list[dict[str, Any]],
) -> None:
    for op in ops:
        if not isinstance(op, dict) or op.get("op") != "write":
            continue
        path = _norm_path(str(op.get("path") or ""))
        if path:
            project_files[path] = str(op.get("content") or "")


def _dedupe_ops_by_path(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_path: dict[str, dict[str, Any]] = {}
    mkdirs: list[dict[str, Any]] = []
    for op in ops:
        if not isinstance(op, dict):
            continue
        kind = str(op.get("op") or "")
        path = _norm_path(str(op.get("path") or ""))
        if kind == "mkdir":
            mkdirs.append(op)
        elif path:
            by_path[path] = op
    return mkdirs + list(by_path.values())


def _narrow_plan_for_task(plan: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    path = _norm_path(str(task.get("path") or ""))
    action = str(task.get("action") or "create").lower()
    narrow = dict(plan)
    if action in ("modify", "patch"):
        narrow["files_to_create"] = []
        narrow["files_to_modify"] = [path]
    else:
        narrow["files_to_create"] = [path]
        narrow["files_to_modify"] = []
    deps = [_norm_path(str(d)) for d in (task.get("depends_on") or []) if d]
    for dep in deps:
        if dep in (plan.get("files_to_modify") or []):
            narrow["files_to_modify"] = list(dict.fromkeys(narrow["files_to_modify"] + [dep]))
        elif dep in (plan.get("files_to_create") or []):
            narrow["files_to_create"] = list(dict.fromkeys(narrow["files_to_create"] + [dep]))
    return narrow


def _tasks_for_paths(
    build_tasks: list[dict[str, Any]],
    paths: set[str],
) -> list[dict[str, Any]]:
    if not paths:
        return []
    by_path = {_norm_path(str(t.get("path") or "")): t for t in build_tasks if t.get("path")}
    ordered: list[dict[str, Any]] = []
    for path in sorted(paths):
        if path in by_path:
            ordered.append(by_path[path])
        else:
            ordered.append(
                {
                    "order": 0,
                    "path": path,
                    "action": "create",
                    "depends_on": [],
                    "summary": f"Criar {path}",
                    "expected_exports": ["default"],
                },
            )
    return ordered


async def _invoke_task_codegen(
    settings: Settings,
    state: dict[str, Any],
    *,
    codegen_sys: str,
    human_base: str,
    project_files: dict[str, str],
    plan: dict[str, Any],
    task: dict[str, Any],
    guidance: str | None,
    parse_json: Callable[[str], dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    path = _norm_path(str(task.get("path") or ""))
    narrow = _narrow_plan_for_task(plan, task)
    chat = get_chat_model(
        settings,
        state.get("model_provider"),
        json_mode=True,
        max_tokens=16384,
    )
    human = (
        human_base
        + f"\n\n## Tarefa actual (OBRIGATÓRIO — gerar só este ficheiro)\n"
        f"path: {path}\n"
        f"action: {task.get('action')}\n"
        f"summary: {task.get('summary') or ''}\n"
        f"expected_exports: {json.dumps(task.get('expected_exports') or ['default'], ensure_ascii=False)}\n"
        f"\n## Plano estreito\n"
        f"criar: {json.dumps(narrow.get('files_to_create') or [], ensure_ascii=False)}\n"
        f"modificar: {json.dumps(narrow.get('files_to_modify') or [], ensure_ascii=False)}\n"
        + "\n\n## Excertos numerados (ancorar old_text)\n"
        + build_codegen_file_excerpts(narrow, project_files)
    )
    if guidance:
        human += f"\n\n## Correcções\n{guidance[:2500]}"
    resp = await chat.ainvoke(
        [SystemMessage(content=codegen_sys), HumanMessage(content=human)],
    )
    data = parse_json(str(resp.content))
    ops_raw = data.get("operations")
    if not isinstance(ops_raw, list):
        ops_raw = []
    resolved, resolve_errs = resolve_codegen_operations(ops_raw, project_files, narrow)
    if not resolved and narrow.get("files_to_modify"):
        resolved_loose, loose_errs = resolve_codegen_operations(ops_raw, project_files, {})
        if len(resolved_loose) > len(resolved):
            resolved = resolved_loose
            resolve_errs = resolve_errs + loose_errs
    valid, verr = validate_polvo_code_operations(resolved)
    return valid, verr + resolve_errs, data


async def run_codegen_per_task(
    settings: Settings,
    state: dict[str, Any],
    *,
    codegen_sys: str,
    human_base: str,
    project_files: dict[str, str],
    plan: dict[str, Any],
    build_tasks: list[dict[str, Any]],
    parse_json: Callable[[str], dict[str, Any]],
    guidance: str | None = None,
    max_missing_retries: int = MAX_MISSING_PATH_RETRIES,
) -> dict[str, Any]:
    """Executa codegen uma chamada LLM por build_task; retry para paths em falta."""
    virtual_files = dict(project_files)
    all_ops: list[dict[str, Any]] = []
    all_errors: list[str] = []
    assistant_parts: list[str] = []
    trace: list[str] = []
    last_data: dict[str, Any] = {}

    tasks = list(build_tasks) if build_tasks else []
    if not tasks:
        tasks = _tasks_for_paths([], plan_paths_from_plan(plan))

    for i, task in enumerate(tasks):
        path = _norm_path(str(task.get("path") or ""))
        if not path:
            continue
        valid, errs, data = await _invoke_task_codegen(
            settings,
            state,
            codegen_sys=codegen_sys,
            human_base=human_base,
            project_files=virtual_files,
            plan=plan,
            task=task,
            guidance=guidance,
            parse_json=parse_json,
        )
        all_ops.extend(valid)
        all_errors.extend(errs)
        _apply_writes_to_virtual_files(virtual_files, valid)
        reply = str(data.get("assistant_reply") or "").strip()
        if reply:
            assistant_parts.append(reply)
        last_data = data
        trace.append(f"task:{i + 1}/{len(tasks)}:{path}:{len(valid)}ops")

    merged_ops = _dedupe_ops_by_path(all_ops)
    plan_paths = plan_paths_from_plan(plan)

    for retry in range(max_missing_retries):
        covered = op_paths_from_ops(merged_ops)
        missing = plan_paths - covered
        if not missing:
            break
        trace.append(f"missing_retry:{retry + 1}:{len(missing)}paths")
        retry_tasks = _tasks_for_paths(tasks, missing)
        for task in retry_tasks:
            path = _norm_path(str(task.get("path") or ""))
            valid, errs, data = await _invoke_task_codegen(
                settings,
                state,
                codegen_sys=codegen_sys,
                human_base=human_base
                + f"\n\n## AVISO — ficheiro em falta no plano\n"
                f"O ficheiro `{path}` ainda não foi gerado. Emite `write` completo.\n",
                project_files=virtual_files,
                plan=plan,
                task=task,
                guidance=guidance,
                parse_json=parse_json,
            )
            merged_ops = _dedupe_ops_by_path(merged_ops + valid)
            all_errors.extend(errs)
            _apply_writes_to_virtual_files(virtual_files, valid)
            reply = str(data.get("assistant_reply") or "").strip()
            if reply:
                assistant_parts.append(reply)
            last_data = data

    final_ops, final_verr = validate_polvo_code_operations(merged_ops)
    all_errors.extend(final_verr)
    covered = op_paths_from_ops(final_ops)
    coverage = f"{len(covered & plan_paths)}/{len(plan_paths)}" if plan_paths else "n/a"
    trace.append(f"coverage:{coverage}")

    return {
        "data": last_data,
        "polvo_code_ops": final_ops,
        "pending_writes": [
            {"op": o["op"], "path": o["path"], "content": o.get("content")} for o in final_ops
        ],
        "validation_errors": all_errors,
        "assistant_reply": " ".join(assistant_parts).strip(),
        "trace": trace,
        "coverage": coverage,
    }
