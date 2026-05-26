"""Grafo LangGraph para desenvolvimento de apps (Frontend Angular/Next + Backend Go/Node).

Fluxo:
  START → context_manager → router → (architect?) → code_generator → compiler_checker
                                                                    ↺ self_healer (retry)
                                                                    → context_finalize → END

Estratégia de tokens: ver docstring de ``DevWorkflowState`` e ``_prompt_bundle``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow_state import (
    DevWorkflowState,
    RouteDecision,
    StackId,
    manifest_from_writes,
    merge_manifest,
    truncate_trace,
)
from openpolvointeligence.graphs.message_utils import last_user_text, tail_messages
from openpolvointeligence.graphs.models import effective_provider, get_chat_model
from openpolvointeligence.graphs.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow_architect_logic import (
    build_architect_human_suffix,
    normalize_architect_plan,
)
from openpolvointeligence.graphs.dev_workflow_router_logic import (
    build_router_human_suffix,
    parse_router_response,
)
from openpolvointeligence.graphs.dev_workflow_codegen_logic import (
    build_codegen_file_excerpts,
    resolve_codegen_operations,
)
from openpolvointeligence.graphs.dev_workflow_code_rag import run_code_rag_for_router
from openpolvointeligence.graphs.dev_workflow_compiler_logic import (
    merge_compile_sources,
    parse_compile_output,
)
from openpolvointeligence.graphs.dev_workflow_self_heal_logic import (
    apply_heal_to_project_files,
    run_self_heal,
)
from openpolvointeligence.graphs.dev_workflow_context_manager import (
    diff_instructions_to_writes,
    run_context_manager,
)
from openpolvointeligence.graphs.preview_console_context import merge_preview_console_block

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"

DEFAULT_MAX_COMPILE_RETRIES = 2


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


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


def _manifest_lines(manifest: list[dict[str, Any]], limit: int = 40) -> str:
    if not manifest:
        return "(projecto vazio — sem ficheiros no manifesto)"
    lines = []
    for row in manifest[:limit]:
        path = str(row.get("path", ""))
        lang = str(row.get("lang", ""))
        size = int(row.get("size", 0))
        lines.append(f"- {path} [{lang}, {size}B]")
    if len(manifest) > limit:
        lines.append(f"... +{len(manifest) - limit} ficheiros")
    return "\n".join(lines)


def _prompt_bundle(state: DevWorkflowState) -> str:
    """Pacote mínimo injectado em cada nó LLM (evita re-enviar messages[])."""
    compact = state.get("compact_context_map") or {}
    compact_json = json.dumps(compact, ensure_ascii=False)[:3500] if compact else "(vazio)"
    diff_n = len(state.get("diff_instructions") or [])
    return (
        f"## Pedido actual\n{state.get('user_prompt', '')[:4000]}\n\n"
        f"## Conversa (digest)\n{state.get('conversation_digest', '')[:2000]}\n\n"
        f"## Projecto (digest)\n{state.get('project_digest', '')[:2000]}\n\n"
        f"## Camadas (Router)\n{state.get('affected_layers') or '—'}\n\n"
        f"## Feature\n{state.get('feature_summary') or state.get('route_reason') or '—'}\n\n"
        f"## Mapa compacto\n{compact_json}\n\n"
        f"## Diff instructions ({diff_n})\n"
        f"{json.dumps((state.get('diff_instructions') or [])[:8], ensure_ascii=False)[:4000]}\n\n"
        f"## Manifesto (paths only)\n{_manifest_lines(state.get('file_manifest') or [])}"
    )


def _normalize_route(raw: str) -> RouteDecision:
    from openpolvointeligence.graphs.dev_workflow_router_logic import normalize_route

    return normalize_route(raw)


def _normalize_stack(raw: str | None) -> StackId | None:
    from openpolvointeligence.graphs.dev_workflow_router_logic import normalize_stack

    return normalize_stack(raw)


def route_after_router(state: DevWorkflowState) -> Literal[
    "architect", "code_generator", "explain_end", "abort_end"
]:
    route = state.get("route") or "architect"
    if route == "explain":
        return "explain_end"
    if route == "abort":
        return "abort_end"
    if route == "patch":
        return "code_generator"
    return "architect"


def route_after_compiler(state: DevWorkflowState) -> Literal["context_finalize", "retry_self_heal"]:
    if state.get("compile_ok"):
        return "context_finalize"
    attempt = int(state.get("compile_attempt") or 0)
    max_r = int(state.get("max_compile_retries") or DEFAULT_MAX_COMPILE_RETRIES)
    if attempt < max_r:
        return "retry_self_heal"
    return "context_finalize"


def build_dev_workflow_graph(settings: Settings) -> Any:
    router_sys = _load_prompt("dev_workflow_router_system")
    architect_sys = _load_prompt("dev_workflow_architect_system")
    codegen_sys = _load_prompt("dev_workflow_codegen_system")

    async def node_context_manager(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        msgs = state.get("messages") or []
        prev_map = state.get("compact_context_map")

        ctx = await run_context_manager(
            settings,
            messages=msgs,
            model_provider=state.get("model_provider"),
            file_tree=state.get("project_file_tree") or [],
            project_files=state.get("project_files") or {},
            file_manifest=list(state.get("file_manifest") or []),
            previous_context_map=prev_map if isinstance(prev_map, dict) else None,
            preview_console_block=state.get("preview_console_block"),
            user_prompt=state.get("user_prompt"),
        )
        return {
            **ctx,
            "trace": trace + ["context_manager"],
        }

    async def node_router(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        compile_attempt = int(state.get("compile_attempt") or 0)
        error_digest = state.get("error_digest") or []

        if compile_attempt > 0 and error_digest:
            return {
                "route": "patch",
                "affected_layers": state.get("affected_layers") or "fullstack",
                "stack_hint": state.get("stack_hint"),
                "route_confidence": 1.0,
                "route_reason": "retry pós-compilador",
                "trace": trace + ["router:patch_retry"],
            }

        rag_update: dict[str, Any] = {}
        try:
            rag_update = await run_code_rag_for_router(settings, dict(state))
        except Exception as exc:
            _logger.warning("Code RAG router skip: %s", exc)

        merged_state = {**dict(state), **rag_update}
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        rag_block = rag_update.get("rag_context_block") or ""
        human = (
            _prompt_bundle(merged_state)  # type: ignore[arg-type]
            + build_router_human_suffix(merged_state)
            + (f"\n\n{rag_block}" if rag_block else "")
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=router_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        parsed = parse_router_response(
            data,
            user_prompt=str(state.get("user_prompt") or ""),
        )

        trace_suffix = f"router:{parsed['route']}:{parsed['affected_layers']}"
        if rag_update.get("rag_relevant_paths"):
            trace_suffix += f":rag{len(rag_update['rag_relevant_paths'])}"

        return {
            **parsed,
            **rag_update,
            "trace": trace + [trace_suffix],
        }

    async def node_architect(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        manifest_paths = [
            str(r.get("path", ""))
            for r in (state.get("file_manifest") or [])
            if isinstance(r, dict) and r.get("path")
        ]
        human = _prompt_bundle(state) + build_architect_human_suffix(state)
        resp = await chat.ainvoke(
            [SystemMessage(content=architect_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        layer = state.get("affected_layers") or "fullstack"
        plan = normalize_architect_plan(
            data,
            affected_layers=layer,  # type: ignore[arg-type]
            stack_hint=state.get("stack_hint"),
            user_prompt=str(state.get("user_prompt") or ""),
            manifest_paths=manifest_paths,
            compact_context_map=state.get("compact_context_map") or {},
            rag_relevant_paths=list(state.get("rag_relevant_paths") or []),
        )
        return {"plan": plan, "trace": trace + [f"architect:{len(plan.get('targets') or [])}files"]}

    async def node_code_generator(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        plan = state.get("plan") or {}
        project_files = state.get("project_files") or {}
        diff_instructions = state.get("diff_instructions") or []
        use_diff = bool(state.get("use_diff_mode"))

        prebuilt: list[dict[str, Any]] = []
        if use_diff and diff_instructions and project_files:
            prebuilt = diff_instructions_to_writes(diff_instructions, project_files)

        if prebuilt and not (state.get("error_digest") or []):
            rationales = [
                str(d.get("rationale", "")).strip()
                for d in diff_instructions
                if d.get("rationale")
            ]
            assistant = (
                "Apliquei as alterações pedidas no preview (modo patch)."
                + (f" {rationales[0][:200]}" if rationales else "")
            )
            valid, verr = validate_polvo_code_operations(prebuilt)
            meta = build_polvo_code_ops_metadata(
                bool(valid),
                valid,
                verr,
                create_project=False,
                npm_install=any(
                    str(o.get("path", "")).endswith("package.json") for o in valid
                ),
            )
            meta["dev_workflow"] = {
                "stack": (state.get("compact_context_map") or {}).get("stack"),
                "route": state.get("route"),
                "compile_attempt": state.get("compile_attempt") or 0,
                "edit_mode": "diff_patch",
            }
            return {
                "pending_writes": [
                    {"op": o["op"], "path": o["path"], "content": o.get("content")}
                    for o in valid
                ],
                "polvo_code_ops": valid,
                "assistant_text": assistant[:600],
                "metadata": meta,
                "trace": trace + ["code_generator:diff_apply"],
            }

        chat = get_chat_model(
            settings,
            state.get("model_provider"),
            json_mode=True,
            max_tokens=16384,
        )
        plan = state.get("plan") or {}
        errors = state.get("error_digest") or []
        err_block = ""
        if errors:
            err_block = "\n\n## Erros de compilação (corrigir)\n" + json.dumps(
                errors[:8], ensure_ascii=False,
            )
        tokens = plan.get("design_tokens") if isinstance(plan, dict) else {}
        tokens_block = ""
        if tokens:
            tokens_block = (
                "\n\n## Design Tokens (OBRIGATÓRIO — aplicar em todo JSX/CSS gerado)\n"
                + json.dumps(tokens, ensure_ascii=False, indent=2)
                + "\n"
            )
        human = (
            _prompt_bundle(state)
            + f"\n\n## Plano (Architect — só estes ficheiros)\n"
            f"criar: {json.dumps(plan.get('files_to_create') or [], ensure_ascii=False)}\n"
            f"modificar: {json.dumps(plan.get('files_to_modify') or [], ensure_ascii=False)}\n"
            f"rotas backend: {json.dumps(plan.get('backend_routes') or [], ensure_ascii=False)[:2000]}\n"
            + tokens_block
            + f"\n\n## Excertos numerados (ancorar old_text)\n"
            + build_codegen_file_excerpts(plan, project_files)
            + err_block
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=codegen_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        ops_raw = data.get("operations")
        if not isinstance(ops_raw, list):
            ops_raw = []
        resolved, resolve_errs = resolve_codegen_operations(
            ops_raw,
            project_files,
            plan if isinstance(plan, dict) else {},
        )
        valid, verr = validate_polvo_code_operations(resolved)
        verr = verr + resolve_errs
        pending: list[dict[str, Any]] = [
            {"op": o["op"], "path": o["path"], "content": o.get("content")}
            for o in valid
        ]
        assistant = str(data.get("assistant_reply") or "").strip()
        if not assistant:
            assistant = "Estou a actualizar o preview com as alterações pedidas."

        meta = build_polvo_code_ops_metadata(
            bool(valid),
            valid,
            verr,
            create_project=bool(data.get("create_project")),
            project_title=str(data.get("project_title") or "").strip() or None,
            npm_install=bool(data.get("npm_install")),
        )
        meta["dev_workflow"] = {
            "stack": plan.get("stack") if isinstance(plan, dict) else None,
            "route": state.get("route"),
            "compile_attempt": state.get("compile_attempt") or 0,
            "edit_mode": str(data.get("edit_mode") or "patch"),
            "design_tokens": (
                plan.get("design_tokens")
                if isinstance(plan, dict) and plan.get("design_tokens")
                else None
            ),
        }

        return {
            "pending_writes": pending,
            "polvo_code_ops": valid,
            "assistant_text": assistant,
            "metadata": meta,
            "trace": trace + ["code_generator"],
        }

    async def node_compiler_checker(state: DevWorkflowState) -> dict[str, Any]:
        """Valida ops + digest de erros externos (WebContainer / preview)."""
        trace = truncate_trace(list(state.get("trace") or []))
        attempt = int(state.get("compile_attempt") or 0) + 1
        max_retries = int(state.get("max_compile_retries") or DEFAULT_MAX_COMPILE_RETRIES)

        merged_log = merge_compile_sources(
            state.get("preview_console_block"),
            None,
            state.get("preview_console_logs"),
        )
        ops = state.get("polvo_code_ops") or []
        verr: list[str] = []
        if not ops:
            verr.append("nenhuma operação gerada")

        has_external_log = bool(merged_log.strip())
        if has_external_log:
            ok, errors = parse_compile_output(merged_log)
        else:
            ok, errors = True, []

        if verr:
            ok = False
            errors = errors + [
                {"path": None, "line": None, "column": None, "message": v, "code": "validation"}
                for v in verr
            ]

        manifest = merge_manifest(
            list(state.get("file_manifest") or []),
            manifest_from_writes(list(state.get("pending_writes") or [])),
        )

        result: dict[str, Any] = {
            "compile_ok": ok,
            "error_digest": errors,
            "compile_attempt": attempt,
            "file_manifest": manifest,
            "trace": trace + [f"compiler_checker:{'ok' if ok else 'fail'}"],
        }

        meta = dict(state.get("metadata") or {})
        if not has_external_log and ok and ops:
            meta["dev_workflow_awaiting_client_build"] = True
        if not ok and attempt <= max_retries:
            meta["dev_workflow_compile_retry"] = True
            meta["dev_workflow_self_heal"] = True
        elif ok:
            meta["dev_workflow_compile_ok"] = True
        result["metadata"] = meta

        return result

    async def node_self_healer(state: DevWorkflowState) -> dict[str, Any]:
        """Self-Healing: patches mínimos a partir do log de compilação."""
        trace = truncate_trace(list(state.get("trace") or []))
        merged_log = merge_compile_sources(
            state.get("preview_console_block"),
            None,
            state.get("preview_console_logs"),
        )
        error_digest = state.get("error_digest") or []
        project_files = dict(state.get("project_files") or {})
        plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}

        if not merged_log.strip() or not error_digest:
            return {"trace": trace + ["self_healer:skip"]}

        heal = await run_self_heal(
            settings,
            state.get("model_provider"),
            user_prompt=str(state.get("user_prompt") or ""),
            compile_log=merged_log,
            error_digest=list(error_digest),
            project_files=project_files,
            plan=plan,
        )
        valid = heal.get("polvo_code_ops") or []
        pending = heal.get("pending_writes") or []
        updated_files = apply_heal_to_project_files(project_files, valid)

        meta = dict(state.get("metadata") or {})
        meta.update(heal.get("metadata") or {})
        meta["dev_workflow_self_heal"] = True
        summary = str(heal.get("heal_summary") or "").strip()
        assistant = state.get("assistant_text") or ""
        if summary:
            assistant = f"{assistant}\n\n{summary}".strip() if assistant else summary

        return {
            "polvo_code_ops": valid,
            "pending_writes": pending,
            "project_files": updated_files,
            "assistant_text": assistant[:800],
            "metadata": meta,
            "preview_console_block": "",
            "preview_console_logs": [],
            "trace": trace + [f"self_healer:{len(valid)}ops"],
        }

    async def node_explain(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)
        human = _prompt_bundle(state) + "\n\nResponde à dúvida sem gerar ficheiros."
        resp = await chat.ainvoke(
            [
                SystemMessage(
                    content="És o assistente de desenvolvimento Open Polvo. Responde em pt-BR, "
                    "2–6 frases, sem código longo.",
                ),
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
                "dev_workflow": {"route": "explain"},
            },
            "trace": trace + ["explain"],
        }

    async def node_abort(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        reason = state.get("route_reason") or "Pedido fora do âmbito de desenvolvimento."
        mp = effective_provider(state.get("model_provider"))
        return {
            "assistant_text": (
                "Não consigo avançar com esse pedido no estúdio de desenvolvimento. "
                f"{reason}"
            )[:600],
            "metadata": {
                "model_provider": mp,
                "dev_workflow": {"route": "abort"},
            },
            "trace": trace + ["abort"],
        }

    async def node_context_finalize(state: DevWorkflowState) -> dict[str, Any]:
        """Actualiza digest pós-sucesso ou esgotamento de retries."""
        trace = truncate_trace(list(state.get("trace") or []))
        if state.get("compile_ok"):
            proj = state.get("project_digest") or ""
            plan = state.get("plan") or {}
            targets = plan.get("targets") if isinstance(plan, dict) else []
            if targets:
                proj = f"{proj}\nÚltima alteração: {', '.join(targets[:5])}".strip()
            return {"project_digest": proj[:2500], "trace": trace + ["context_finalize"]}
        return {"trace": trace + ["context_finalize:unchanged"]}

    g = StateGraph(DevWorkflowState)

    g.add_node("context_manager", node_context_manager)
    g.add_node("router", node_router)
    g.add_node("architect", node_architect)
    g.add_node("code_generator", node_code_generator)
    g.add_node("compiler_checker", node_compiler_checker)
    g.add_node("self_healer", node_self_healer)
    g.add_node("explain", node_explain)
    g.add_node("abort", node_abort)
    g.add_node("context_finalize", node_context_finalize)

    g.add_edge(START, "context_manager")
    g.add_edge("context_manager", "router")
    g.add_conditional_edges(
        "router",
        route_after_router,
        {
            "architect": "architect",
            "code_generator": "code_generator",
            "explain_end": "explain",
            "abort_end": "abort",
        },
    )
    g.add_edge("architect", "code_generator")
    g.add_edge("code_generator", "compiler_checker")
    g.add_conditional_edges(
        "compiler_checker",
        route_after_compiler,
        {
            "context_finalize": "context_finalize",
            "retry_self_heal": "self_healer",
        },
    )
    g.add_edge("self_healer", "compiler_checker")
    g.add_edge("explain", END)
    g.add_edge("abort", END)
    g.add_edge("context_finalize", END)

    return g.compile()


_compiled: Any = None


def get_dev_workflow_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_dev_workflow_graph(settings)
    return _compiled


def reset_dev_workflow_graph_cache() -> None:
    global _compiled
    _compiled = None


async def run_dev_workflow_pipeline(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    *,
    workspace_id: str | None = None,
    file_manifest: list[dict[str, Any]] | None = None,
    project_digest: str | None = None,
    preview_console_logs: list[dict[str, Any]] | None = None,
    compile_log: str | None = None,
    project_file_tree: list[str] | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Executa o pipeline completo de desenvolvimento."""
    graph = get_dev_workflow_graph(settings)
    preview_block = merge_preview_console_block(workspace_id, preview_console_logs)
    if compile_log and compile_log.strip():
        preview_block = (preview_block or "") + "\n\n### Build log\n" + compile_log[:8000]

    prev_ctx = dev_studio_context if isinstance(dev_studio_context, dict) else {}
    compact_prev = prev_ctx.get("compact_context_map")
    if not isinstance(compact_prev, dict):
        compact_prev = None

    out = await graph.ainvoke(
        {
            "messages": messages,
            "model_provider": model_provider,
            "workspace_id": workspace_id,
            "file_manifest": file_manifest or prev_ctx.get("file_manifest") or [],
            "project_digest": project_digest or str(prev_ctx.get("project_digest") or ""),
            "compact_context_map": compact_prev or {},
            "project_file_tree": project_file_tree or prev_ctx.get("project_file_tree") or [],
            "project_files": project_files or prev_ctx.get("project_files") or {},
            "preview_console_block": preview_block,
            "preview_console_logs": preview_console_logs,
            "compile_attempt": 0,
            "max_compile_retries": DEFAULT_MAX_COMPILE_RETRIES,
            "trace": [],
        },
    )
    text = str(out.get("assistant_text") or "").strip()
    meta = out.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    mp = effective_provider(model_provider)
    meta.setdefault("model_provider", mp)
    meta.setdefault("routed_intent", "polvo_code_builder")
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
        "project_id": workspace_id or prev_ctx.get("project_id"),
    }
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
                        create_project=not bool((workspace_id or "").strip()),
                        project_title=str(meta.get("polvo_code_project_title") or "").strip()
                        or None,
                        npm_install=True,
                    ),
                )
        elif merged_project_files:
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
                        create_project=not bool((workspace_id or "").strip()),
                        npm_install=True,
                    ),
                )
    return text, meta


def _merge_project_files_state(
    out: dict[str, Any],
    incoming: dict[str, str] | None,
    previous: dict[str, str] | None,
) -> dict[str, str]:
    """Funde ficheiros do turno anterior + entrada + writes gerados."""
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
