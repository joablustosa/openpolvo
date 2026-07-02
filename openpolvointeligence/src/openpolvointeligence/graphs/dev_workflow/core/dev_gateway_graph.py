"""Gateway DevAgent — classificação, planeamento por workflow e pipeline core."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk.desk_tool_bridge import (
    DeskToolBridge,
    clear_bridge,
    set_bridge,
)
from openpolvointeligence.graphs.desk.desk_tool_logic import TERMINAL_TIMEOUT_S
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import inject_dev_agent_system
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import (
    classify_request_kind,
    create_project_for_kind,
    route_for_request_kind,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
    prefix_polvo_code_operations,
    resolve_project_root_for_new_app,
)
from openpolvointeligence.graphs.dev_workflow.scaffold_ops import merge_scaffold_operations
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import (
    DevWorkflowState,
    truncate_trace,
)
from openpolvointeligence.graphs.dev_workflow.core.workflow_dispatch import (
    resolve_plan_runner,
    workflow_id_for_kind,
)
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.message_utils import last_user_text
from openpolvointeligence.graphs.models import effective_provider, get_chat_model, resolve_dev_workflow_provider
from openpolvointeligence.graphs.preview_console_context import merge_preview_console_block
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    build_terminal_port,
    reset_terminal_port,
    set_terminal_port,
)

_logger = logging.getLogger(__name__)

DEFAULT_MAX_COMPILE_RETRIES = 2

_GATEWAY_PROGRESS: dict[str, tuple[str, str]] = {
    "classify": ("dev_classify", "A classificar o pedido…"),
    "workflow_plan": ("dev_plan", "A planear a execução…"),
    "dispatch_workflow": ("dev_dispatch", "A executar workflow…"),
    "explain": ("dev_explain", "A responder sem alterar código…"),
    "abort": ("dev_abort", "A concluir pedido fora de âmbito…"),
}

_WORKFLOW_STEP_LABELS: dict[str, tuple[str, str]] = {
    "context_loader": ("dev_context_load", "A carregar contexto do projecto…"),
    "requirements": ("dev_requirements", "A recolher requisitos…"),
    "stack_selector": ("dev_stack", "A seleccionar stack…"),
    "impact_analyzer": ("dev_impact", "A analisar impacto…"),
    "agent_loop": ("dev_agent_loop", "A explorar e editar código (agente)…"),
    "legacy_core": ("dev_codegen", "A gerar e validar código…"),
    "type_check": ("dev_typecheck", "A verificar TypeScript…"),
    "lint_fix": ("dev_lint", "A corrigir lint…"),
    "test_runner": ("dev_test", "A executar testes…"),
    "lint_test_parallel": ("dev_lint_test", "A corrigir lint e executar testes em paralelo…"),
    "dev_workflow": ("dev_heartbeat", "A processar…"),
    "dev_heartbeat": ("dev_heartbeat", "A processar…"),
    "dependency": ("dev_deps", "A instalar dependências…"),
    "migration": ("dev_migrate", "A aplicar migrations…"),
    "git": ("dev_git", "A registar alterações no git…"),
    "workspace_opener": ("dev_open_workspace", "A abrir projecto no Explorer…"),
    "corrective": ("dev_corrective", "A corrigir erros TypeScript…"),
    "edit": ("dev_edit", "A aplicar edições…"),
    "delete": ("dev_delete", "A remover ficheiros…"),
    "test": ("dev_test", "A executar testes…"),
    "review": ("dev_review", "A rever código…"),
    "deliver": ("dev_deliver", "A preparar entrega…"),
    "pause_check": ("dev_pause", "A verificar confirmação…"),
    "review_gate": ("dev_review_gate", "A validar revisão…"),
    "delivery_gate": ("dev_delivery_gate", "A validar gates de entrega…"),
}

_CORE_PROGRESS: dict[str, tuple[str, str]] = {
    "prompt_enricher": ("dev_enrich", "A produtificar o pedido…"),
    "context_manager": ("dev_context", "A preparar contexto compacto…"),
    "router": ("dev_route", "A rotear camadas e stack…"),
    "architect": ("dev_architect", "A planear ficheiros e estrutura…"),
    "orchestrator": ("dev_orchestrator", "A decompor tarefas de build…"),
    "code_generator": ("dev_codegen", "A gerar código…"),
    "static_verify": ("dev_verify", "A verificar estaticamente…"),
    "compiler_checker": ("dev_compile", "A validar compilação…"),
    "build_sandbox": ("dev_build", "A executar build sandbox…"),
    "self_healer": ("dev_heal", "A corrigir erros automaticamente…"),
    "context_finalize": ("dev_finalize", "A finalizar contexto…"),
}


def route_after_classify(
    state: DevWorkflowState,
) -> Literal["explain", "abort", "workflow_plan"]:
    kind = str(state.get("request_kind") or "")
    if kind == "explain":
        return "explain"
    if kind == "abort":
        return "abort"
    return "workflow_plan"


def _progress_event(step: str, labels: dict[str, tuple[str, str]]) -> dict[str, Any]:
    step_id, label = labels.get(step, (step, step))
    return {"type": "progress", "step": step_id, "label": label}


def _normalize_stream_chunk(chunk: Any) -> dict[str, Any]:
    """Converte chunk LangGraph (dict ou tuplo namespace+data) em update dict."""
    if isinstance(chunk, dict):
        data = chunk.get("data")
        if "type" in chunk and isinstance(data, dict):
            return data
        return chunk
    if isinstance(chunk, tuple) and len(chunk) >= 2:
        payload = chunk[-1]
        if isinstance(payload, dict):
            return payload
    return {}


def _flatten_stream_chunk(chunk: Any) -> list[tuple[str, dict[str, Any]]]:
    """Achata updates de subgrafos (ex.: step_legacy_core → architect)."""
    update = _normalize_stream_chunk(chunk)
    flat: list[tuple[str, dict[str, Any]]] = []

    def _emit(node_name: str, patch: Any) -> None:
        if isinstance(patch, tuple) and len(patch) == 2 and isinstance(patch[1], dict):
            _emit(str(patch[0]), patch[1])
            return
        if not isinstance(patch, dict):
            return
        inner_core = [
            (str(k), v)
            for k, v in patch.items()
            if isinstance(k, str) and isinstance(v, dict) and k in _CORE_PROGRESS
        ]
        if inner_core:
            flat.extend(inner_core)
            return
        flat.append((str(node_name), patch))

    if not isinstance(update, dict):
        return flat
    for node_name, patch in update.items():
        _emit(str(node_name), patch)
    return flat


def _agent_event_for_sse(ev: dict[str, Any]) -> dict[str, Any]:
    """Formato esperado pelo normalizer do polvocode (`event_type` + `payload`)."""
    event_type = str(ev.get("type") or "step")
    payload = {k: v for k, v in ev.items() if k != "type"}
    return {"type": "agent_event", "event_type": event_type, "payload": payload}


def _yield_patch_stream_events(
    patch: dict[str, Any],
    merged: dict[str, Any],
    *,
    workspace_id: str | None,
    emitted_files: set[str],
    stream_project_root: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    """Converte patch de estado em eventos SSE (ficheiros, agent_event, project_root)."""
    events: list[dict[str, Any]] = []
    root_out = stream_project_root
    for ev in patch.get("agent_events") or []:
        if isinstance(ev, dict):
            events.append(_agent_event_for_sse(ev))
    ops, root = _prepare_ops_for_stream(
        _collect_ops_from_patch(patch),
        merged,
        workspace_id=workspace_id,
    )
    if root and root != root_out:
        root_out = root
        events.append(
            {
                "type": "progress",
                "step": "dev_project_root",
                "label": f"A criar projecto em `{root}/`…",
                "payload": {"project_root": root, "create_project": True},
            },
        )
    for ev in _file_events_from_ops(ops):
        key = f"{ev['file'].get('op')}:{ev['file'].get('path')}"
        if key not in emitted_files:
            emitted_files.add(key)
            events.append(ev)
    return events, root_out


def _has_project(state: DevWorkflowState) -> bool:
    return bool(str(state.get("workspace_id") or "").strip()) or bool(state.get("project_files"))


def _stable_project_id_for_pipeline(
    conversation_id: str | None,
    workspace_id: str | None,
    prev_ctx: dict[str, Any],
) -> str:
    for cand in (conversation_id, workspace_id, prev_ctx.get("project_id")):
        if cand and str(cand).strip():
            return str(cand).strip()
    return "default-dev-studio-project"


def _merge_project_files_state(
    out: dict[str, Any],
    incoming: dict[str, str] | None,
    previous: dict[str, str] | None,
) -> dict[str, str]:
    merged: dict[str, str] = {}
    if isinstance(previous, dict):
        merged.update({str(k): str(v) for k, v in previous.items()})
    if isinstance(incoming, dict):
        merged.update({str(k): str(v) for k, v in incoming.items()})
    state_files = out.get("project_files")
    if isinstance(state_files, dict):
        merged.update({str(k): str(v) for k, v in state_files.items()})
    for w in out.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            merged[str(w["path"])] = str(w.get("content") or "")
    return merged


def _file_events_from_ops(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    lang_map = {
        "tsx": "tsx",
        "jsx": "jsx",
        "ts": "typescript",
        "js": "javascript",
        "css": "css",
        "json": "json",
        "md": "markdown",
    }
    seen_mkdir: set[str] = set()
    mkdir_ops: list[dict[str, Any]] = []
    other_ops: list[dict[str, Any]] = []
    for op in ops:
        if not isinstance(op, dict):
            continue
        path = str(op.get("path") or "").strip()
        if not path:
            continue
        op_kind = str(op.get("op") or "write")
        if op_kind == "mkdir":
            if path in seen_mkdir:
                continue
            seen_mkdir.add(path)
            mkdir_ops.append(op)
        else:
            other_ops.append(op)
    ordered = mkdir_ops + other_ops
    for op in ordered:
        path = str(op.get("path") or "").strip()
        op_kind = str(op.get("op") or "write")
        if op_kind == "mkdir":
            events.append(
                {
                    "type": "file",
                    "file": {
                        "path": path,
                        "op": "mkdir",
                        "language": "directory",
                        "content": "",
                    },
                },
            )
            continue
        if op_kind == "delete":
            events.append(
                {
                    "type": "file",
                    "file": {
                        "path": path,
                        "op": "delete",
                        "language": "plaintext",
                        "content": "",
                    },
                },
            )
            continue
        if op_kind != "write":
            continue
        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        events.append(
            {
                "type": "file",
                "file": {
                    "path": path,
                    "op": "write",
                    "language": lang_map.get(ext, "plaintext"),
                    "content": str(op.get("content") or ""),
                },
            },
        )
    return events


def _collect_ops_from_patch(patch: dict[str, Any]) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    for key in ("polvo_code_ops", "pending_writes"):
        raw = patch.get(key)
        if isinstance(raw, list):
            ops.extend([o for o in raw if isinstance(o, dict)])
    plan = patch.get("plan")
    if isinstance(plan, dict):
        for d in plan.get("mkdirs") or []:
            p = str(d).strip()
            if p:
                ops.append({"op": "mkdir", "path": p})
    return ops


def _project_title_from_state(state: dict[str, Any]) -> str | None:
    for key in ("project_title", "polvo_code_project_title"):
        value = str(state.get(key) or "").strip()
        if value:
            return value
    plan = state.get("execution_plan")
    if isinstance(plan, dict):
        summary = str(plan.get("summary") or "").strip()
        if summary:
            return summary[:80]
    prompt = str(state.get("user_prompt") or "").strip()
    return prompt[:80] if prompt else None


def _stack_from_state(state: dict[str, Any]) -> str | None:
    plan = state.get("plan")
    if isinstance(plan, dict) and plan.get("stack"):
        return str(plan["stack"])
    hint = state.get("stack_hint")
    return str(hint).strip() if hint else None


def _design_tokens_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    plan = state.get("plan")
    if isinstance(plan, dict) and isinstance(plan.get("design_tokens"), dict):
        return plan["design_tokens"]
    return None


def _existing_paths_from_state(state: dict[str, Any]) -> set[str]:
    pf = state.get("project_files")
    if isinstance(pf, dict):
        return {str(k).replace("\\", "/") for k in pf}
    return set()


def _all_pending_ops(
    state: dict[str, Any], patch: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    for source in (state, patch or {}):
        ops.extend(_collect_ops_from_patch(source))
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for op in ops:
        if not isinstance(op, dict):
            continue
        path = str(op.get("path") or "").strip()
        key = f"{op.get('op')}:{path}"
        if path and key in seen:
            continue
        if path:
            seen.add(key)
        deduped.append(op)
    return deduped


def _has_workspace_context(state: dict[str, Any], workspace_id: str | None) -> bool:
    return (
        bool(str(workspace_id or state.get("workspace_path") or "").strip())
        or bool(state.get("project_files"))
        or bool(str(state.get("workspace_id") or "").strip())
    )


def _early_project_root_progress(
    state: dict[str, Any],
    workspace_id: str | None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Emite pasta do projecto antes do codegen para o cliente prefixar paths."""
    has_workspace = _has_workspace_context(state, workspace_id)
    kind = str(state.get("request_kind") or "")
    create = create_project_for_kind(kind, has_workspace=has_workspace) if kind else False
    if not create:
        return None, None
    root = resolve_project_root_for_new_app(
        create_project=True,
        has_workspace=has_workspace,
        project_title=_project_title_from_state(state),
        operations=_all_pending_ops(state),
    )
    if not root:
        return None, None
    return (
        {
            "type": "progress",
            "step": "dev_project_root",
            "label": f"A criar projecto em `{root}/`…",
            "payload": {"project_root": root, "create_project": True},
        },
        root,
    )


def _prepare_ops_for_stream(
    patch_ops: list[dict[str, Any]],
    state: dict[str, Any],
    *,
    workspace_id: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    has_workspace = _has_workspace_context(state, workspace_id)
    kind = str(state.get("request_kind") or "")
    create = (
        create_project_for_kind(kind, has_workspace=has_workspace)
        if kind
        else bool(state.get("create_project"))
    )
    title = _project_title_from_state(state)
    cumulative = _all_pending_ops(state)
    if patch_ops:
        cumulative = _all_pending_ops(state, {"pending_writes": patch_ops})
    if create and cumulative:
        cumulative = merge_scaffold_operations(
            cumulative,
            create_project=True,
            stack=_stack_from_state(state),
            project_title=title,
            design_tokens=_design_tokens_from_state(state),
            existing_paths=_existing_paths_from_state(state),
        )
    root = resolve_project_root_for_new_app(
        create_project=create,
        has_workspace=has_workspace,
        project_title=title,
        operations=cumulative or patch_ops,
    )
    emit_ops = cumulative if cumulative else patch_ops
    if not root:
        return emit_ops, None
    return prefix_polvo_code_operations(emit_ops, root), root


async def _finalize_metadata(
    settings: Settings,
    out: dict[str, Any],
    *,
    model_provider: str | None,
    workspace_id: str | None,
    project_files: dict[str, str] | None,
    project_file_tree: list[str] | None,
    dev_studio_context: dict[str, Any] | None,
    stable_pid: str,
    preview_block: str | None,
    compile_log: str | None,
    messages: list[dict[str, Any]],
) -> tuple[str, dict[str, Any]]:
    text = str(out.get("assistant_text") or "").strip()
    meta = out.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    mp = effective_provider(model_provider)
    meta.setdefault("model_provider", mp)
    meta.setdefault("routed_intent", "polvo_code_builder")

    dw_meta = meta.get("dev_workflow")
    if not isinstance(dw_meta, dict):
        dw_meta = {}
    if out.get("workflow_id"):
        dw_meta.setdefault("workflow_id", out.get("workflow_id"))
    if out.get("execution_plan"):
        dw_meta.setdefault("execution_plan", out.get("execution_plan"))
    if out.get("impact_analysis"):
        dw_meta.setdefault("impact_analysis", out.get("impact_analysis"))
    if out.get("openapi_spec"):
        dw_meta.setdefault("openapi_spec", out.get("openapi_spec"))
    if out.get("refactor_plan"):
        dw_meta.setdefault("refactor_plan", out.get("refactor_plan"))
    if out.get("review_result"):
        dw_meta.setdefault("review_result", out.get("review_result"))
    if out.get("completed_steps"):
        dw_meta.setdefault("completed_steps", out.get("completed_steps"))
    if out.get("enriched_brief") and isinstance(out.get("enriched_brief"), dict):
        dw_meta.setdefault("enriched_brief", out.get("enriched_brief"))
    if "enrichment_skipped" in out:
        dw_meta.setdefault("prompt_enrichment_skipped", bool(out.get("enrichment_skipped")))
    if out.get("team_traces"):
        dw_meta["team_traces"] = out.get("team_traces")
    if out.get("static_verify"):
        dw_meta["static_verify"] = out.get("static_verify")
    if out.get("build_tasks"):
        dw_meta["build_tasks"] = out.get("build_tasks")
    if out.get("orchestration"):
        dw_meta["orchestration"] = out.get("orchestration")
    dw_meta.setdefault("stack", out.get("stack_hint"))
    dw_meta.setdefault("stack_source", out.get("stack_source"))
    dw_meta.setdefault("stack_defaulted", bool(out.get("stack_defaulted")))
    dw_meta.setdefault("request_kind", out.get("request_kind"))
    build_result = out.get("build_result")
    if isinstance(build_result, dict) and build_result:
        dw_meta["build_result"] = build_result
    else:
        dw_meta.setdefault(
            "build_result",
            {"ok": True, "ran": False, "tool": "tsc", "errors": []},
        )
    style_guide = out.get("style_guide")
    if isinstance(style_guide, dict) and style_guide:
        dw_meta["style_guide"] = style_guide
    dw_meta.setdefault("team_mode", bool(getattr(settings, "dev_workflow_team_mode", True)))
    if dw_meta:
        meta["dev_workflow"] = dw_meta

    prev_ctx = dev_studio_context if isinstance(dev_studio_context, dict) else {}
    merged_project_files = _merge_project_files_state(
        out,
        project_files,
        prev_ctx.get("project_files") if isinstance(prev_ctx, dict) else None,
    )
    meta["dev_studio_context"] = {
        "compact_context_map": out.get("compact_context_map") or {},
        "project_digest": out.get("project_digest") or "",
        "file_manifest": out.get("file_manifest") or [],
        "project_file_tree": out.get("project_file_tree") or project_file_tree or [],
        "project_files": merged_project_files,
        "rag_relevant_paths": out.get("rag_relevant_paths") or [],
        "project_id": out.get("project_id") or stable_pid,
    }

    out_request_kind = str(out.get("request_kind") or "")
    has_workspace = bool((workspace_id or "").strip()) or bool(merged_project_files)
    fallback_create_project = (
        create_project_for_kind(out_request_kind, has_workspace=has_workspace)
        if out_request_kind
        else not has_workspace
    )
    if not meta.get("polvo_code_ops_pending"):
        pending = out.get("pending_writes") or out.get("polvo_code_ops") or []
        if isinstance(pending, list) and pending:
            valid, verr = validate_polvo_code_operations(pending)
            if valid:
                meta.update(
                    build_polvo_code_ops_metadata(
                        True,
                        valid,
                        verr,
                        create_project=fallback_create_project,
                        project_title=_project_title_from_state(out)
                        or str(meta.get("polvo_code_project_title") or "").strip()
                        or None,
                        npm_install=True,
                        has_workspace=has_workspace,
                        stack=_stack_from_state(out),
                        design_tokens=_design_tokens_from_state(out),
                        existing_paths=set(merged_project_files.keys()),
                    ),
                )
        if not meta.get("polvo_code_ops_pending"):
            from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_routing import (
                should_use_dev_workflow,
            )

            user = last_user_text(messages)
            if should_use_dev_workflow(
                user,
                sandbox_project_id=workspace_id,
                project_files=merged_project_files,
                dev_studio_context=meta.get("dev_studio_context")
                if isinstance(meta.get("dev_studio_context"), dict)
                else None,
                preview_console_block=preview_block,
                compile_log=compile_log,
            ):
                try:
                    from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
                        polvo_code_ops_metadata_for_reply,
                    )

                    supplemental = await polvo_code_ops_metadata_for_reply(
                        settings,
                        model_provider,
                        text or user,
                        messages,
                    )
                    if supplemental.get("polvo_code_ops_pending"):
                        meta.update(supplemental)
                except Exception as exc:
                    _logger.warning("fallback polvo_code_ops após dev workflow: %s", exc)
        if not meta.get("polvo_code_ops_pending") and merged_project_files:
            file_ops = [
                {"op": "write", "path": p, "content": c}
                for p, c in merged_project_files.items()
                if isinstance(p, str) and p.strip()
            ]
            valid, verr = validate_polvo_code_operations(file_ops[:100])
            if valid:
                meta.update(
                    build_polvo_code_ops_metadata(
                        True,
                        valid,
                        verr,
                        create_project=fallback_create_project,
                        project_title=_project_title_from_state(out),
                        npm_install=True,
                        has_workspace=has_workspace,
                        stack=_stack_from_state(out),
                        design_tokens=_design_tokens_from_state(out),
                        existing_paths=set(merged_project_files.keys()),
                    ),
                )
    return text, meta


def build_dev_gateway_graph(settings: Settings) -> Any:
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_graph import (
        build_dev_workflow_graph,
    )

    use_legacy = bool(getattr(settings, "dev_workflow_legacy_core", False))
    core_graph = build_dev_workflow_graph(settings) if use_legacy else None
    nodes = _make_gateway_nodes(settings, core_graph=core_graph)

    g = StateGraph(DevWorkflowState)
    g.add_node("classify", nodes["classify"])
    g.add_node("workflow_plan", nodes["workflow_plan"])
    g.add_node("explain", nodes["explain"])
    g.add_node("abort", nodes["abort"])

    if use_legacy:
        g.add_node("core_pipeline", nodes["core_pipeline"])
    else:
        g.add_node("dispatch_workflow", nodes["dispatch_workflow"])

    g.add_edge(START, "classify")
    g.add_conditional_edges(
        "classify",
        route_after_classify,
        {
            "explain": "explain",
            "abort": "abort",
            "workflow_plan": "workflow_plan",
        },
    )
    if use_legacy:
        g.add_edge("workflow_plan", "core_pipeline")
        g.add_edge("core_pipeline", END)
    else:
        g.add_edge("workflow_plan", "dispatch_workflow")
        g.add_edge("dispatch_workflow", END)
    g.add_edge("explain", END)
    g.add_edge("abort", END)

    return g.compile()


def _make_gateway_nodes(
    settings: Settings,
    *,
    core_graph: Any | None,
) -> dict[str, Any]:
    from openpolvointeligence.graphs.dev_workflow.workflows.graph_factory import (
        get_workflow_graph,
    )

    async def node_classify(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        user_prompt = str(state.get("user_prompt") or last_user_text(state.get("messages") or []))
        has_proj = _has_project(state)
        has_build_errors = bool(
            (state.get("preview_console_block") or "").strip()
            or (state.get("compile_log") or "").strip()
        )
        kind = classify_request_kind(
            user_prompt,
            has_project=has_proj,
            has_build_errors=has_build_errors,
        )
        route = route_for_request_kind(
            kind,
            user_prompt=user_prompt,
            has_project=has_proj,
        )
        wf_id = workflow_id_for_kind(kind)
        return {
            "user_prompt": user_prompt or state.get("user_prompt"),
            "request_kind": kind,
            "workflow_id": wf_id,
            "route": route,
            "route_confidence": 1.0,
            "route_reason": f"gateway:classify:{kind}",
            "trace": trace + [f"gateway:classify:{kind}:{wf_id}"],
        }

    async def node_workflow_plan(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        kind = str(state.get("request_kind") or "feature")
        runner = resolve_plan_runner(kind)
        try:
            patch = await runner(settings, state)
        except Exception as exc:
            _logger.warning("workflow_plan falhou (%s) — continua sem plano LLM", exc)
            patch = {
                "workflow_id": workflow_id_for_kind(kind),
                "execution_plan": {
                    "workflow": workflow_id_for_kind(kind),
                    "summary": str(state.get("user_prompt") or "")[:200],
                    "steps": [],
                },
            }
        return {
            **patch,
            "trace": trace + [f"gateway:plan:{patch.get('workflow_id', kind)}"],
        }

    async def node_core_pipeline(state: DevWorkflowState) -> dict[str, Any]:
        assert core_graph is not None
        result = await core_graph.ainvoke(dict(state))
        if not isinstance(result, dict):
            return {}
        return result

    async def node_dispatch_workflow(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        wf_id = str(
            state.get("workflow_id")
            or workflow_id_for_kind(str(state.get("request_kind") or "feature")),
        )
        sub = get_workflow_graph(settings, wf_id)
        result = await sub.ainvoke(dict(state))
        if not isinstance(result, dict):
            return {"trace": trace + [f"gateway:workflow:{wf_id}:empty"]}
        result["workflow_id"] = wf_id
        result["trace"] = trace + list(result.get("trace") or []) + [f"gateway:workflow:{wf_id}"]
        return result

    async def node_explain(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        human = (
            f"## Pedido\n{state.get('user_prompt', '')[:4000]}\n\n"
            "Responde à dúvida sem gerar ficheiros."
        )
        explain_sys = inject_dev_agent_system(
            "És o assistente de desenvolvimento Open Polvo. Responde em pt-BR, "
            "2–6 frases, sem código longo."
        )
        resp = await chat.ainvoke(
            [
                SystemMessage(content=explain_sys),
                HumanMessage(content=human),
            ],
        )
        text = str(resp.content).strip()
        mp = effective_provider(state.get("model_provider"))
        return {
            "assistant_text": text,
            "metadata": {
                "model_provider": mp,
                "routed_intent": "polvo_code_builder",
                "dev_workflow": {
                    "route": "explain",
                    "request_kind": "explain",
                    "workflow_id": "explain",
                },
            },
            "trace": trace + ["gateway:explain"],
        }

    async def node_abort(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        reason = state.get("route_reason") or "Pedido fora do âmbito de desenvolvimento."
        mp = effective_provider(state.get("model_provider"))
        return {
            "assistant_text": (
                f"Não consigo avançar com esse pedido no estúdio de desenvolvimento. {reason}"
            )[:600],
            "metadata": {
                "model_provider": mp,
                "dev_workflow": {
                    "route": "abort",
                    "request_kind": "abort",
                    "workflow_id": "abort",
                },
            },
            "trace": trace + ["gateway:abort"],
        }

    return {
        "classify": node_classify,
        "workflow_plan": node_workflow_plan,
        "explain": node_explain,
        "abort": node_abort,
        "core_pipeline": node_core_pipeline,
        "dispatch_workflow": node_dispatch_workflow,
    }


def build_dev_gateway_preamble_graph(settings: Settings) -> Any:
    """Gateway até workflow_plan (sem dispatch) — para streaming incremental."""
    nodes = _make_gateway_nodes(settings, core_graph=None)
    g = StateGraph(DevWorkflowState)
    g.add_node("classify", nodes["classify"])
    g.add_node("workflow_plan", nodes["workflow_plan"])
    g.add_node("explain", nodes["explain"])
    g.add_node("abort", nodes["abort"])
    g.add_edge(START, "classify")
    g.add_conditional_edges(
        "classify",
        route_after_classify,
        {
            "explain": "explain",
            "abort": "abort",
            "workflow_plan": "workflow_plan",
        },
    )
    g.add_edge("workflow_plan", END)
    g.add_edge("explain", END)
    g.add_edge("abort", END)
    return g.compile()


_compiled_preamble: Any = None
_compiled_preamble_key: tuple[bool, int, bool] | None = None


def get_dev_gateway_preamble_graph(settings: Settings) -> Any:
    global _compiled_preamble, _compiled_preamble_key
    key = (
        bool(getattr(settings, "dev_workflow_team_mode", True)),
        int(getattr(settings, "dev_workflow_max_review_rounds", 3) or 3),
        bool(getattr(settings, "dev_workflow_legacy_core", False)),
    )
    if _compiled_preamble is None or _compiled_preamble_key != key:
        _compiled_preamble = build_dev_gateway_preamble_graph(settings)
        _compiled_preamble_key = key
    return _compiled_preamble


_compiled_gateway: Any = None
_compiled_gateway_key: tuple[bool, int, bool] | None = None


def get_dev_gateway_graph(settings: Settings) -> Any:
    global _compiled_gateway, _compiled_gateway_key
    key = (
        bool(getattr(settings, "dev_workflow_team_mode", True)),
        int(getattr(settings, "dev_workflow_max_review_rounds", 3) or 3),
        bool(getattr(settings, "dev_workflow_legacy_core", False)),
    )
    if _compiled_gateway is None or _compiled_gateway_key != key:
        _compiled_gateway = build_dev_gateway_graph(settings)
        _compiled_gateway_key = key
    return _compiled_gateway


def reset_dev_gateway_graph_cache() -> None:
    global _compiled_gateway, _compiled_gateway_key
    _compiled_gateway = None
    _compiled_gateway_key = None


def _build_initial_state(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    workspace_id: str | None = None,
    conversation_id: str | None = None,
    file_manifest: list[dict[str, Any]] | None = None,
    project_digest: str | None = None,
    preview_console_logs: list[dict[str, Any]] | None = None,
    compile_log: str | None = None,
    project_file_tree: list[str] | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str, str | None]:
    preview_block = merge_preview_console_block(workspace_id, preview_console_logs)
    if compile_log and compile_log.strip():
        preview_block = (preview_block or "") + "\n\n### Build log\n" + compile_log[:8000]

    prev_ctx = dev_studio_context if isinstance(dev_studio_context, dict) else {}
    compact_prev = prev_ctx.get("compact_context_map")
    if not isinstance(compact_prev, dict):
        compact_prev = None

    stable_pid = _stable_project_id_for_pipeline(conversation_id, workspace_id, prev_ctx)
    wp = str(prev_ctx.get("workspace_path") or workspace_id or "").strip() or None

    state_in: dict[str, Any] = {
        "messages": messages,
        "model_provider": model_provider,
        "workspace_id": workspace_id,
        "workspace_path": wp,
        "conversation_id": conversation_id,
        "project_id": stable_pid,
        "file_manifest": file_manifest or prev_ctx.get("file_manifest") or [],
        "project_digest": project_digest or str(prev_ctx.get("project_digest") or ""),
        "compact_context_map": compact_prev or {},
        "project_file_tree": project_file_tree or prev_ctx.get("project_file_tree") or [],
        "project_files": project_files or prev_ctx.get("project_files") or {},
        "preview_console_block": preview_block,
        "preview_console_logs": preview_console_logs,
        "compile_log": compile_log,
        "compile_attempt": 0,
        "max_compile_retries": DEFAULT_MAX_COMPILE_RETRIES,
        "corrective_attempts": 0,
        "delivery_gate_retries": 0,
        "terminal_errors": [],
        "trace": [],
    }
    return state_in, stable_pid, preview_block


async def run_dev_workflow_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    workspace_id: str | None = None,
    conversation_id: str | None = None,
    file_manifest: list[dict[str, Any]] | None = None,
    project_digest: str | None = None,
    preview_console_logs: list[dict[str, Any]] | None = None,
    compile_log: str | None = None,
    project_file_tree: list[str] | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    graph = get_dev_gateway_graph(settings)
    state_in, stable_pid, preview_block = _build_initial_state(
        settings,
        messages,
        model_provider,
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        file_manifest=file_manifest,
        project_digest=project_digest,
        preview_console_logs=preview_console_logs,
        compile_log=compile_log,
        project_file_tree=project_file_tree,
        project_files=project_files,
        dev_studio_context=dev_studio_context,
    )
    out = await graph.ainvoke(state_in)
    return await _finalize_metadata(
        settings,
        out if isinstance(out, dict) else {},
        model_provider=model_provider,
        workspace_id=workspace_id,
        project_files=project_files,
        project_file_tree=project_file_tree,
        dev_studio_context=dev_studio_context,
        stable_pid=stable_pid,
        preview_block=preview_block,
        compile_log=compile_log,
        messages=messages,
    )


async def run_dev_workflow_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    workspace_id: str | None = None,
    conversation_id: str | None = None,
    file_manifest: list[dict[str, Any]] | None = None,
    project_digest: str | None = None,
    preview_console_logs: list[dict[str, Any]] | None = None,
    compile_log: str | None = None,
    project_file_tree: list[str] | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_graph import (
        build_dev_workflow_graph,
    )
    from openpolvointeligence.graphs.dev_workflow.workflows.graph_factory import (
        get_workflow_graph,
    )

    state_in, stable_pid, preview_block = _build_initial_state(
        settings,
        messages,
        model_provider,
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        file_manifest=file_manifest,
        project_digest=project_digest,
        preview_console_logs=preview_console_logs,
        compile_log=compile_log,
        project_file_tree=project_file_tree,
        project_files=project_files,
        dev_studio_context=dev_studio_context,
    )

    from openpolvointeligence.graphs.dev_workflow.integrations.mcp.registry import (
        register_desk_bridge_tools,
    )
    from openpolvointeligence.graphs.dev_workflow.runtime.session import (
        get_or_create_session,
        resolve_thread_id,
        session_config,
        try_resume_merged_state,
    )

    register_desk_bridge_tools()
    thread_id = resolve_thread_id(str(conversation_id or ""), stable_pid)
    get_or_create_session(str(conversation_id or "anonymous"), project_id=stable_pid or "")
    state_in["thread_id"] = thread_id
    state_in["conversation_id"] = conversation_id
    dc = dev_studio_context if isinstance(dev_studio_context, dict) else {}
    state_in["model_provider"] = resolve_dev_workflow_provider(model_provider, settings, dc)

    merged: dict[str, Any] = dict(state_in)
    emitted_files: set[str] = set()
    stream_project_root: str | None = None
    use_legacy = bool(getattr(settings, "dev_workflow_legacy_core", False))

    try:
        preamble = get_dev_gateway_preamble_graph(settings)
        async for chunk in preamble.astream(state_in):
            for node_name, patch in _flatten_stream_chunk(chunk):
                merged.update(patch)
                patch_events, stream_project_root = _yield_patch_stream_events(
                    patch,
                    merged,
                    workspace_id=workspace_id,
                    emitted_files=emitted_files,
                    stream_project_root=stream_project_root,
                )
                for ev in patch_events:
                    yield ev
                if node_name in _GATEWAY_PROGRESS:
                    yield _progress_event(node_name, _GATEWAY_PROGRESS)

        kind = str(merged.get("request_kind") or "")
        if kind in ("explain", "abort"):
            text, meta = await _finalize_metadata(
                settings,
                merged,
                model_provider=model_provider,
                workspace_id=workspace_id,
                project_files=project_files,
                project_file_tree=project_file_tree,
                dev_studio_context=dev_studio_context,
                stable_pid=stable_pid,
                preview_block=preview_block,
                compile_log=compile_log,
                messages=messages,
            )
            yield {"type": "done", "assistant_text": text, "metadata": meta}
            return

        yield _progress_event("dispatch_workflow", _GATEWAY_PROGRESS)

        early_ev, early_root = _early_project_root_progress(merged, workspace_id)
        if early_ev:
            merged["polvo_code_project_root"] = early_root
            yield early_ev

        if use_legacy:
            execution_graph = build_dev_workflow_graph(settings)
            progress_labels: dict[str, tuple[str, str]] = _CORE_PROGRESS
        else:
            wf_id = str(
                merged.get("workflow_id") or workflow_id_for_kind(kind or "feature"),
            )
            merged["workflow_id"] = wf_id
            execution_graph = get_workflow_graph(settings, wf_id)
            progress_labels = _WORKFLOW_STEP_LABELS

        cid = str(conversation_id or merged.get("conversation_id") or "").strip()
        bridge = DeskToolBridge()
        exec_q: asyncio.Queue[Any] = asyncio.Queue()
        terminal_timeout = float(
            getattr(settings, "dev_workflow_terminal_timeout_s", None) or TERMINAL_TIMEOUT_S,
        )

        if cid:
            set_bridge(cid, bridge)

        async def bridge_wait(
            _conversation_id: str,
            call_id: str,
            payload: dict[str, Any],
            timeout_s: float,
        ) -> dict[str, Any]:
            bridge.register(call_id)
            await exec_q.put(
                _agent_event_for_sse(
                    {
                        "type": "tool_call",
                        "id": call_id,
                        "tool": payload.get("tool"),
                        "name": payload.get("tool"),
                        "args": payload.get("args") or {},
                        "requires_client": True,
                    },
                ),
            )
            return await bridge.wait(call_id, timeout_s=timeout_s or terminal_timeout)

        async def emit_tool(kind: str, payload: dict[str, Any]) -> None:
            # text_delta é um tipo SSE top-level (texto incremental) — os restantes
            # eventos vão embrulhados como agent_event.
            if kind == "text_delta":
                await exec_q.put({"type": "text_delta", "delta": str(payload.get("delta") or "")})
            elif kind == "workflow_step":
                step_key = str(payload.get("step") or "").strip()
                if step_key in progress_labels:
                    await exec_q.put(_progress_event(step_key, progress_labels))
                elif step_key in _CORE_PROGRESS:
                    await exec_q.put(_progress_event(step_key, _CORE_PROGRESS))
            else:
                await exec_q.put(_agent_event_for_sse({"type": kind, **payload}))

        port = build_terminal_port(
            settings,
            merged,
            bridge_wait=bridge_wait,
            emit=emit_tool,
        )
        port_token = set_terminal_port(port)

        exec_error: dict[str, str] = {}

        async def run_execution() -> None:
            try:
                lg_config = session_config(str(merged.get("thread_id") or ""))
                resume_patch = await try_resume_merged_state(
                    execution_graph,
                    lg_config,
                    merged,
                )
                if resume_patch:
                    merged.update(resume_patch)
                async for chunk in execution_graph.astream(
                    merged,
                    config=lg_config,
                    subgraphs=True,
                ):
                    await exec_q.put(("chunk", chunk))
            except Exception as exc:  # noqa: BLE001 — erro tem de chegar ao utilizador
                _logger.exception("dev workflow execution falhou")
                exec_error["detail"] = str(exc)[:400]
                await exec_q.put(
                    _agent_event_for_sse(
                        {"type": "workflow_error", "detail": exec_error["detail"]},
                    ),
                )
            finally:
                await exec_q.put(None)

        exec_task = asyncio.create_task(run_execution())
        _HEARTBEAT_S = 18.0
        try:
            while True:
                try:
                    item = await asyncio.wait_for(exec_q.get(), timeout=_HEARTBEAT_S)
                except TimeoutError:
                    yield _progress_event("dev_workflow", _WORKFLOW_STEP_LABELS)
                    continue
                if item is None:
                    break
                if isinstance(item, tuple) and item[0] == "chunk":
                    chunk = item[1]
                    for node_name, patch in _flatten_stream_chunk(chunk):
                        merged.update(patch)
                        patch_events, stream_project_root = _yield_patch_stream_events(
                            patch,
                            merged,
                            workspace_id=workspace_id,
                            emitted_files=emitted_files,
                            stream_project_root=stream_project_root,
                        )
                        for ev in patch_events:
                            yield ev
                        if node_name in progress_labels:
                            yield _progress_event(node_name, progress_labels)
                            step_id, label = progress_labels[node_name]
                            from openpolvointeligence.graphs.dev_workflow.runtime.events import (
                                emit_step_event,
                            )

                            yield emit_step_event(
                                str(merged.get("thread_id") or ""),
                                step_id,
                                label,
                                agent=node_name,
                            )
                        elif node_name.startswith("step_"):
                            step_key = node_name.removeprefix("step_")
                            if step_key in progress_labels:
                                yield _progress_event(step_key, progress_labels)
                        elif node_name in ("review_gate", "delivery_gate"):
                            yield _progress_event(node_name, progress_labels)
                        elif node_name in _CORE_PROGRESS:
                            yield _progress_event(node_name, _CORE_PROGRESS)
                elif isinstance(item, dict):
                    yield item
        finally:
            if not exec_task.done():
                exec_task.cancel()
            await asyncio.gather(exec_task, return_exceptions=True)
            if cid:
                clear_bridge(cid)
            reset_terminal_port(port_token)

        if not use_legacy:
            merged.setdefault(
                "workflow_id",
                workflow_id_for_kind(kind or "feature"),
            )

        text, meta = await _finalize_metadata(
            settings,
            merged,
            model_provider=model_provider,
            workspace_id=workspace_id,
            project_files=project_files,
            project_file_tree=project_file_tree,
            dev_studio_context=dev_studio_context,
            stable_pid=stable_pid,
            preview_block=preview_block,
            compile_log=compile_log,
            messages=messages,
        )
        if exec_error.get("detail") and not (
            isinstance(meta, dict) and meta.get("polvo_code_ops")
        ):
            from openpolvointeligence.graphs.dev_workflow.core.llm_resilience import (
                format_dev_workflow_llm_error,
                is_llm_retriable_error,
            )
            from openpolvointeligence.graphs.dev_workflow.core.scaffold_fallback import (
                build_scaffold_fallback_patch,
                can_scaffold_fallback,
            )

            raw_detail = exec_error["detail"]
            used_scaffold = False
            if is_llm_retriable_error(Exception(raw_detail)) and can_scaffold_fallback(merged):
                fallback = build_scaffold_fallback_patch(settings, merged, llm_error=raw_detail)
                merged.update(fallback)
                text, meta = await _finalize_metadata(
                    settings,
                    merged,
                    model_provider=merged.get("model_provider") or model_provider,
                    workspace_id=workspace_id,
                    project_files=project_files,
                    project_file_tree=project_file_tree,
                    dev_studio_context=dev_studio_context,
                    stable_pid=stable_pid,
                    preview_block=preview_block,
                    compile_log=compile_log,
                    messages=messages,
                )
                used_scaffold = True
                exec_error.clear()

            if not used_scaffold:
                detail = format_dev_workflow_llm_error(
                    raw_detail,
                    str(merged.get("model_provider") or model_provider),
                    settings,
                )
                text = (
                    (text + "\n\n") if text.strip() else ""
                ) + f"⚠️ O workflow de desenvolvimento falhou antes de gerar ficheiros: {detail}"
                if isinstance(meta, dict):
                    meta["error_kind"] = "dev_workflow_execution_failed"
        ops = meta.get("polvo_code_ops") if isinstance(meta, dict) else None
        if isinstance(ops, list):
            for ev in _file_events_from_ops(ops):
                key = f"{ev['file'].get('op')}:{ev['file'].get('path')}"
                if key not in emitted_files:
                    emitted_files.add(key)
                    yield ev
        yield {"type": "done", "assistant_text": text, "metadata": meta}
    except Exception as exc:
        _logger.exception("dev_workflow stream failed")
        from openpolvointeligence.graphs.dev_workflow.core.llm_resilience import (
            format_dev_workflow_llm_error,
        )

        friendly = format_dev_workflow_llm_error(
            str(exc),
            str(model_provider or ""),
            settings,
        )
        yield {
            "type": "done",
            "assistant_text": (
                f"Não foi possível concluir o fluxo de desenvolvimento. {friendly}"
            ),
            "metadata": {
                "intent": "polvo_code_builder",
                "routed_intent": "polvo_code_builder",
                "error_kind": "dev_workflow_stream_failed",
                "model_provider": effective_provider(model_provider),
            },
        }
