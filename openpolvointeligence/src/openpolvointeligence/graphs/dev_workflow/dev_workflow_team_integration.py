"""Integração dos times worker+revisor nos nós do Dev Workflow."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
    retrieve_for_reviewer,
    stable_project_id,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_codegen_per_task import (
    op_paths_from_ops,
    plan_paths_from_plan,
    run_codegen_per_task,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_orchestrator_logic import (
    build_orchestrator_human_suffix,
    normalize_build_tasks,
    validate_orchestration,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_prompt_enricher_logic import (
    normalize_enriched_prompt,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_review_logic import parse_review_response
from openpolvointeligence.graphs.dev_workflow.dev_workflow_team import run_team_review_loop
from openpolvointeligence.graphs.models import get_chat_model
from openpolvointeligence.graphs.dev_workflow.preview_source_sanitize import (
    preview_source_has_forbidden_imports,
)


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


async def _reviewer_context(settings: Settings, state: dict[str, Any]) -> str:
    """Pedido original do utilizador + bloco RAG para os reviewers avaliarem em contexto."""
    user_prompt = str(state.get("user_prompt") or "")
    rag_block = str(state.get("rag_context_block") or "")
    if not rag_block:
        rag_block, _ = await retrieve_for_reviewer(
            settings,
            stable_project_id(state),
            user_prompt,
        )
    parts = [f"## Pedido original do utilizador\n{user_prompt[:2000]}"]
    if rag_block:
        parts.append(rag_block)
    return "\n\n".join(parts)


def gate_plan(plan: dict[str, Any]) -> tuple[bool, list[str]]:
    errors: list[str] = []
    for path in (plan.get("files_to_create") or []) + (plan.get("files_to_modify") or []):
        p = str(path).replace("\\", "/")
        if (
            "components/layout/" in p
            and "Navbar" not in p
            and "AppShell" not in p
            and "Sidebar" not in p
        ):
            errors.append(f"layout scaffold no plano: {p}")
    if not (plan.get("files_to_create") or plan.get("files_to_modify") or plan.get("targets")):
        errors.append("plano sem ficheiros alvo")
    return len(errors) == 0, errors


def gate_orchestration(
    build_tasks: list[dict[str, Any]],
    plan: dict[str, Any],
) -> tuple[bool, list[str]]:
    return validate_orchestration(build_tasks, plan)


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def _is_backend_path(path: str) -> bool:
    p = _norm_path(path)
    return p.startswith("server/") or p.startswith("backend/")


def gate_codegen_result(result: dict[str, Any], plan: dict[str, Any]) -> tuple[bool, list[str]]:
    errors: list[str] = []
    verr = result.get("validation_errors") or []
    errors.extend(str(e) for e in verr[:8])
    valid = result.get("polvo_code_ops") or []
    if not valid:
        errors.append("nenhuma operação válida gerada")
    plan_paths = plan_paths_from_plan(plan)
    if plan_paths:
        op_paths = op_paths_from_ops(valid)
        missing = plan_paths - op_paths
        if missing and not result.get("diff_mode"):
            errors.append(f"paths em falta: {', '.join(sorted(missing)[:8])}")
        if not op_paths & plan_paths and not result.get("diff_mode"):
            errors.append("ops não cobrem ficheiros do plano")
    for o in valid:
        content = str(o.get("content") or "")
        if preview_source_has_forbidden_imports(content):
            errors.append(f"import proibido em {o.get('path')}")
    return len(errors) == 0, errors


async def run_prompt_enricher_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    enricher_sys: str,
    prompt_reviewer_sys: str,
    raw: str,
    short_history_json: str,
    max_rounds: int,
) -> dict[str, Any]:
    chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)

    async def worker(guidance: str | None) -> dict[str, Any]:
        human = "## Pedido cru\n" + raw[:4000] + "\n\n## Histórico curto\n" + short_history_json
        if guidance:
            human += f"\n\n## Correcções do revisor\n{guidance[:2000]}"
        resp = await chat.ainvoke(
            [SystemMessage(content=enricher_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        return normalize_enriched_prompt(data, raw=raw)

    async def reviewer(enriched: dict[str, Any]) -> dict[str, Any]:
        human = (
            f"## Pedido cru\n{raw[:2000]}\n\n"
            f"## Brief enriquecido\n{json.dumps(enriched, ensure_ascii=False)[:4000]}"
        )
        rev_chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        resp = await rev_chat.ainvoke(
            [SystemMessage(content=prompt_reviewer_sys), HumanMessage(content=human)],
        )
        return parse_review_response(str(resp.content))

    enriched, review, trace = await run_team_review_loop(
        team_name="prompt",
        worker=worker,
        reviewer=reviewer,
        max_rounds=max_rounds,
        deterministic_gate=None,
    )
    return {
        "enriched": enriched,
        "review": review,
        "trace": trace,
        "rounds": len([t for t in trace if ":review:" in t]),
    }


async def run_architect_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    architect_sys: str,
    plan_reviewer_sys: str,
    human_base: str,
    normalize_plan_fn: Any,
    max_rounds: int,
) -> dict[str, Any]:
    chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
    reviewer_ctx = await _reviewer_context(settings, state)

    async def worker(guidance: str | None) -> dict[str, Any]:
        human = human_base
        if guidance:
            human += f"\n\n## Correcções do revisor de plano\n{guidance[:2500]}"
        resp = await chat.ainvoke(
            [SystemMessage(content=architect_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        return normalize_plan_fn(data)

    async def reviewer(plan: dict[str, Any]) -> dict[str, Any]:
        human = (
            f"{reviewer_ctx}\n\n## Plano proposto\n{json.dumps(plan, ensure_ascii=False)[:6000]}"
        )
        rev_chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        resp = await rev_chat.ainvoke(
            [SystemMessage(content=plan_reviewer_sys), HumanMessage(content=human)],
        )
        return parse_review_response(str(resp.content))

    plan, review, trace = await run_team_review_loop(
        team_name="plan",
        worker=worker,
        reviewer=reviewer,
        max_rounds=max_rounds,
        deterministic_gate=gate_plan,
        skip_reviewer_on_gate=False,
    )
    return {"plan": plan, "review": review, "trace": trace}


async def run_orchestrator_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    orchestrator_sys: str,
    max_rounds: int,
) -> dict[str, Any]:
    plan = state.get("plan") or {}
    if isinstance(plan, dict):
        plan = {**plan, "_project_files": state.get("project_files") or {}}
    chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
    human_base = build_orchestrator_human_suffix(state)

    async def worker(guidance: str | None) -> list[dict[str, Any]]:
        human = human_base
        if guidance:
            human += f"\n\n## Correcções\n{guidance[:2000]}"
        resp = await chat.ainvoke(
            [SystemMessage(content=orchestrator_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        return normalize_build_tasks(data.get("build_tasks"), plan)

    async def reviewer(tasks: list[dict[str, Any]]) -> dict[str, Any]:
        ok, errs = gate_orchestration(tasks, plan)
        if ok:
            return {"approved": True, "score": 1.0, "issues": [], "guidance": ""}
        return {
            "approved": False,
            "score": 0.3,
            "issues": [{"message": e} for e in errs],
            "guidance": "Corrigir ordem e cobertura das build_tasks.",
        }

    tasks, review, trace = await run_team_review_loop(
        team_name="orchestrator",
        worker=worker,
        reviewer=reviewer,
        max_rounds=max_rounds,
        deterministic_gate=lambda t: gate_orchestration(t, plan),
    )
    return {
        "build_tasks": tasks,
        "review": review,
        "trace": trace,
        "notes": "",
    }


async def run_backend_codegen_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    codegen_sys: str,
    code_reviewer_sys: str,
    human_base: str,
    project_files: dict[str, str],
    plan: dict[str, Any],
    max_rounds: int,
    stack: str | None = None,
) -> dict[str, Any]:
    """Time dedicado a ficheiros backend (server/* ou backend/*)."""
    backend_tasks = [
        t
        for t in (state.get("build_tasks") or [])
        if _is_backend_path(str(t.get("path", "")))
    ]
    if not backend_tasks:
        return {
            "result": {
                "data": {},
                "polvo_code_ops": [],
                "pending_writes": [],
                "validation_errors": [],
                "assistant_reply": "",
            },
            "review": {"approved": True, "score": 1.0, "issues": [], "guidance": ""},
            "trace": ["backend:skipped"],
        }

    backend_plan = dict(plan)
    backend_plan["files_to_create"] = [
        str(t.get("path")) for t in backend_tasks if t.get("action") == "create"
    ]
    backend_plan["files_to_modify"] = [
        str(t.get("path")) for t in backend_tasks if t.get("action") in ("modify", "patch")
    ]
    backend_state = dict(state)
    backend_state["build_tasks"] = backend_tasks

    if stack == "fullstack-react-go" or any(
        str(t.get("path", "")).startswith("backend/") for t in backend_tasks
    ):
        backend_human = (
            human_base + "\n\n## Camada backend Go (OBRIGATÓRIO neste turno)\n"
            "Gera ficheiros em backend/internal/app/* seguindo hexagonal (domain/ports/application/adapters).\n"
            "Regista rotas em backend/internal/transport/http/router.go via chi.\n"
            "Não reescrevas backend/cmd/api/main.go nem middleware CORS base.\n"
            f"api_endpoints: {json.dumps(plan.get('api_endpoints') or plan.get('backend_routes') or [], ensure_ascii=False)[:2000]}\n"
        )
    else:
        backend_human = (
            human_base + "\n\n## Camada backend (OBRIGATÓRIO neste turno)\n"
            "Gera ficheiros em server/* usando Hono + Drizzle + PGlite (já no scaffold).\n"
            "Usa imports de drizzle-orm/pg-core, hono, @electric-sql/pglite.\n"
            "Regista rotas em server/index.ts via app.route().\n"
            f"api_endpoints: {json.dumps(plan.get('api_endpoints') or plan.get('backend_routes') or [], ensure_ascii=False)[:2000]}\n"
            f"db_tables: {json.dumps(plan.get('db_tables') or [], ensure_ascii=False)[:2000]}\n"
        )
    return await run_codegen_team(
        settings,
        backend_state,
        codegen_sys=codegen_sys,
        code_reviewer_sys=code_reviewer_sys,
        human_base=backend_human,
        project_files=project_files,
        plan=backend_plan,
        max_rounds=max_rounds,
    )


async def run_codegen_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    codegen_sys: str,
    code_reviewer_sys: str,
    human_base: str,
    project_files: dict[str, str],
    plan: dict[str, Any],
    max_rounds: int,
) -> dict[str, Any]:
    build_tasks = state.get("build_tasks") or []
    reviewer_ctx = await _reviewer_context(settings, state)

    async def worker(guidance: str | None) -> dict[str, Any]:
        per_task = await run_codegen_per_task(
            settings,
            state,
            codegen_sys=codegen_sys,
            human_base=human_base,
            project_files=project_files,
            plan=plan,
            build_tasks=build_tasks,
            parse_json=_parse_json_object,
            guidance=guidance,
        )
        return {
            "data": per_task.get("data") or {},
            "polvo_code_ops": per_task.get("polvo_code_ops") or [],
            "pending_writes": per_task.get("pending_writes") or [],
            "validation_errors": per_task.get("validation_errors") or [],
            "assistant_reply": str(per_task.get("assistant_reply") or "").strip(),
            "coverage": per_task.get("coverage"),
        }

    async def reviewer(result: dict[str, Any]) -> dict[str, Any]:
        gate_ok, gate_errs = gate_codegen_result(result, plan)
        if gate_ok:
            return {
                "approved": True,
                "score": 1.0,
                "issues": [],
                "guidance": "",
                "gate": "deterministic",
            }
        human = (
            f"{reviewer_ctx}\n\n"
            f"## Operações\n{json.dumps(result.get('polvo_code_ops') or [], ensure_ascii=False)[:4000]}\n\n"
            f"## Erros de validação\n{json.dumps(result.get('validation_errors') or [], ensure_ascii=False)}"
        )
        rev_chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        resp = await rev_chat.ainvoke(
            [SystemMessage(content=code_reviewer_sys), HumanMessage(content=human)],
        )
        review = parse_review_response(str(resp.content))
        if gate_errs:
            review["approved"] = False
            review["issues"] = (review.get("issues") or []) + [
                {"message": e} for e in gate_errs[:6]
            ]
        return review

    result, review, trace = await run_team_review_loop(
        team_name="code",
        worker=worker,
        reviewer=reviewer,
        max_rounds=max_rounds,
        deterministic_gate=lambda r: gate_codegen_result(r, plan),
        skip_reviewer_on_gate=True,
    )
    return {"result": result, "review": review, "trace": trace}


async def run_fullstack_codegen_team(
    settings: Settings,
    state: dict[str, Any],
    *,
    codegen_sys: str,
    code_reviewer_sys: str,
    human_base: str,
    project_files: dict[str, str],
    plan: dict[str, Any],
    max_rounds: int,
) -> dict[str, Any]:
    """Executa times backend e frontend e funde ops."""
    stack = str(plan.get("stack") or state.get("stack_hint") or "")
    backend_out = await run_backend_codegen_team(
        settings,
        state,
        codegen_sys=codegen_sys,
        code_reviewer_sys=code_reviewer_sys,
        human_base=human_base,
        project_files=project_files,
        plan=plan,
        max_rounds=max_rounds,
        stack=stack,
    )
    # Claude Code-like: o frontend vê o backend já "escrito" neste turno.
    be_ops = list((backend_out.get("result") or {}).get("polvo_code_ops") or [])
    fe_project_files = dict(project_files)
    backend_summary_lines: list[str] = []
    for op in be_ops:
        if not isinstance(op, dict) or op.get("op") != "write":
            continue
        path = str(op.get("path") or "").replace("\\", "/").lstrip("/")
        if not path:
            continue
        fe_project_files[path] = str(op.get("content") or "")
        backend_summary_lines.append(path)

    build_tasks = state.get("build_tasks") or []
    frontend_tasks = [
        t for t in build_tasks if not _is_backend_path(str(t.get("path", "")))
    ]
    fe_state = dict(state)
    fe_state["build_tasks"] = frontend_tasks
    fe_state["project_files"] = fe_project_files
    fe_plan = dict(plan)
    fe_plan["files_to_create"] = [
        str(t.get("path")) for t in frontend_tasks if t.get("action") == "create"
    ]
    fe_plan["files_to_modify"] = [
        str(t.get("path")) for t in frontend_tasks if t.get("action") in ("modify", "patch")
    ]
    backend_block = ""
    if backend_summary_lines:
        backend_block = (
            "\n\n## Backend já gerado neste turno (consome via fetch /api/*)\n"
            + "\n".join(f"- {p}" for p in backend_summary_lines[:20])
        )
    if stack == "fullstack-react-go" or any(
        str(t.get("path", "")).startswith("frontend/") for t in frontend_tasks
    ):
        frontend_human = (
            human_base + "\n\n## Camada frontend\n"
            "Usa react-router-dom (BrowserRouter no main.tsx). Páginas em frontend/src/pages/*.\n"
            "Consome API via frontend/src/lib/api.ts (fetch /api/*). Não reescrevas backend/*.\n"
            + backend_block
        )
    else:
        frontend_human = (
            human_base + "\n\n## Camada frontend\n"
            "Usa react-router-dom (BrowserRouter no main.tsx). Páginas em src/pages/*.\n"
            "Consome API via src/lib/api.ts (fetch /api/*). Não reescrevas server/*.\n" + backend_block
        )
    frontend_out = await run_codegen_team(
        settings,
        fe_state,
        codegen_sys=codegen_sys,
        code_reviewer_sys=code_reviewer_sys,
        human_base=frontend_human,
        project_files=fe_project_files,
        plan=fe_plan,
        max_rounds=max_rounds,
    )

    be_result = backend_out.get("result") or {}
    fe_result = frontend_out.get("result") or {}
    merged_ops = list(be_result.get("polvo_code_ops") or []) + list(
        fe_result.get("polvo_code_ops") or []
    )
    merged_writes = list(be_result.get("pending_writes") or []) + list(
        fe_result.get("pending_writes") or []
    )
    merged_errors = list(be_result.get("validation_errors") or []) + list(
        fe_result.get("validation_errors") or []
    )
    assistant = " ".join(
        s
        for s in [
            str(be_result.get("assistant_reply") or "").strip(),
            str(fe_result.get("assistant_reply") or "").strip(),
        ]
        if s
    ).strip()
    merged_result = {
        "data": fe_result.get("data") or be_result.get("data") or {},
        "polvo_code_ops": merged_ops,
        "pending_writes": merged_writes,
        "validation_errors": merged_errors,
        "assistant_reply": assistant,
    }
    trace = list(backend_out.get("trace") or []) + list(frontend_out.get("trace") or [])
    approved = bool(
        (backend_out.get("review") or {}).get("approved", True)
        and (frontend_out.get("review") or {}).get("approved", True)
    )
    return {
        "result": merged_result,
        "review": {
            "approved": approved,
            "score": 1.0 if approved else 0.4,
            "issues": [],
            "guidance": "",
        },
        "trace": trace,
    }
