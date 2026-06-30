"""Grafo LangGraph para desenvolvimento de apps.

Stack do scaffold: **React (Vite) + Node (Hono)** com Tailwind v4 + shadcn
(full-stack TS; react-router-dom no main.tsx). Sem Angular/Next/NextAuth/Supabase.

Fluxo (team mode):
  START → prompt_enricher (time) → context_manager → router
        → architect (time) → orchestrator (time) → code_generator (time)
        → static_verify → compiler_checker → build_sandbox ↺ self_healer
        → context_finalize → END

Fluxo legacy (DEV_WORKFLOW_TEAM_MODE=false):
  START → prompt_enricher → context_manager → router → architect → code_generator
        → compiler_checker → build_sandbox ↺ self_healer → context_finalize → END
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_state import (
    DevWorkflowState,
    RouteDecision,
    StackId,
    manifest_from_writes,
    merge_manifest,
    truncate_trace,
)
from openpolvointeligence.graphs.message_utils import tail_messages
from openpolvointeligence.graphs.models import effective_provider, get_chat_model
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_architect_logic import (
    build_architect_human_suffix,
    normalize_architect_plan,
)
from openpolvointeligence.graphs.dev_workflow.agents.agent_context import (
    build_agent_context_block,
    merge_execution_plan_into_targets,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_router_logic import (
    build_router_human_suffix,
    parse_router_response,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_request_kind import (
    create_project_for_kind,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_codegen_logic import (
    build_codegen_file_excerpts,
    resolve_codegen_operations,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
    reindex_project_files,
    retrieve_for_architect,
    retrieve_for_codegen_task,
    run_code_rag_for_router,
    stable_project_id,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_style_rag import (
    build_style_guide_block,
    design_tokens_from_style_guide,
    retrieve_style_guide,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_build_sandbox import (
    build_errors_to_digest,
    run_build_sandbox,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_error_memory import (
    build_error_memory_block,
    index_error_fix,
    recall_similar_errors,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_prompt_enricher_logic import (
    build_raw_user_prompt,
    normalize_enriched_prompt,
    should_enrich,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_compiler_logic import (
    merge_compile_sources,
    parse_compile_output,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_self_heal_logic import (
    apply_heal_to_project_files,
    run_self_heal,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_context_manager import (
    diff_instructions_to_writes,
    run_context_manager,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_static_verify import run_static_verify
from openpolvointeligence.graphs.dev_workflow.dev_workflow_orchestrator_logic import (
    build_tasks_from_plan,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_team_integration import (
    run_architect_team,
    run_fullstack_codegen_team,
    run_orchestrator_team,
    run_prompt_enricher_team,
)

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts"

DEFAULT_MAX_COMPILE_RETRIES = 2


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _with_dev_agent(prompt: str) -> str:
    from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import (
        inject_dev_agent_system,
    )

    return inject_dev_agent_system(prompt) if prompt else prompt


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


def _request_kind_codegen_directive(kind: str) -> str:
    """Directiva curta que orienta o codegen consoante o tipo de pedido."""
    k = (kind or "").strip().lower()
    if k == "new_app":
        return (
            "\n\n## Tipo de pedido: NOVA APLICAÇÃO\n"
            "Gera o projecto completo e coerente (multi-página com react-router-dom, "
            "componentes shadcn reais, lógica funcional). Pode usar writes completos."
        )
    if k == "feature":
        return (
            "\n\n## Tipo de pedido: NOVA FEATURE\n"
            "NÃO recries o scaffold nem ficheiros existentes que não mudam. "
            "Cria só os ficheiros novos da feature e aplica PATCHES mínimos (old_text exacto) "
            "nos ficheiros existentes que precisam de ligação (rotas, navegação, imports)."
        )
    if k == "bug_fix":
        return (
            "\n\n## Tipo de pedido: CORRECÇÃO DE BUG\n"
            "Altera o MÍNIMO necessário para resolver o erro. Usa PATCHES (old_text exacto) "
            "nos ficheiros afectados. NÃO reescrevas ficheiros inteiros nem recries o scaffold. "
            "Mantém o resto do código intacto."
        )
    return ""


def _normalize_route(raw: str) -> RouteDecision:
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_router_logic import normalize_route

    return normalize_route(raw)


def _normalize_stack(raw: str | None) -> StackId | None:
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_router_logic import normalize_stack

    return normalize_stack(raw)


def route_after_router(
    state: DevWorkflowState,
) -> Literal["architect", "code_generator", "explain_end", "abort_end"]:
    route = state.get("route") or "architect"
    has_project = bool(str(state.get("workspace_id") or "").strip()) or bool(
        state.get("project_files"),
    )
    if route == "explain" and has_project:
        return "code_generator"
    if route == "explain":
        return "explain_end"
    if route == "abort":
        return "abort_end"
    if route == "patch":
        return "code_generator"
    return "architect"


def route_after_compiler(
    state: DevWorkflowState,
) -> Literal["build_sandbox", "context_finalize", "retry_self_heal"]:
    if state.get("compile_ok"):
        # Build sandbox real é o portão final anti-bug antes de finalizar.
        return "build_sandbox"
    attempt = int(state.get("compile_attempt") or 0)
    max_r = int(state.get("max_compile_retries") or DEFAULT_MAX_COMPILE_RETRIES)
    if attempt < max_r:
        return "retry_self_heal"
    return "context_finalize"


def route_after_build_sandbox(
    state: DevWorkflowState,
) -> Literal["context_finalize", "retry_self_heal"]:
    br = state.get("build_result") or {}
    if not isinstance(br, dict) or br.get("ok"):
        return "context_finalize"
    attempt = int(state.get("compile_attempt") or 0)
    max_r = int(state.get("max_compile_retries") or DEFAULT_MAX_COMPILE_RETRIES)
    if attempt < max_r:
        return "retry_self_heal"
    return "context_finalize"


def route_after_static_verify(
    state: DevWorkflowState,
) -> Literal["compiler_checker", "retry_self_heal"]:
    sv = state.get("static_verify") or {}
    if isinstance(sv, dict) and sv.get("ok"):
        return "compiler_checker"
    attempt = int(state.get("compile_attempt") or 0)
    max_r = int(state.get("max_compile_retries") or DEFAULT_MAX_COMPILE_RETRIES)
    if attempt < max_r:
        return "retry_self_heal"
    return "compiler_checker"


def build_dev_workflow_graph(settings: Settings) -> Any:
    team_mode = bool(getattr(settings, "dev_workflow_team_mode", True))
    max_review_rounds = int(getattr(settings, "dev_workflow_max_review_rounds", 3) or 3)

    router_sys = _with_dev_agent(_load_prompt("dev_workflow_router_system"))
    architect_sys = _with_dev_agent(_load_prompt("dev_workflow_architect_system"))
    codegen_sys = _with_dev_agent(_load_prompt("dev_workflow_codegen_system"))
    style_sys = _with_dev_agent(_load_prompt("dev_workflow_style_system"))
    enricher_sys = _with_dev_agent(_load_prompt("dev_workflow_prompt_enricher_system"))
    prompt_reviewer_sys = (
        _with_dev_agent(_load_prompt("dev_workflow_prompt_reviewer_system")) if team_mode else ""
    )
    plan_reviewer_sys = (
        _with_dev_agent(_load_prompt("dev_workflow_plan_reviewer_system")) if team_mode else ""
    )
    orchestrator_sys = (
        _with_dev_agent(_load_prompt("dev_workflow_orchestrator_system")) if team_mode else ""
    )
    code_reviewer_sys = (
        _with_dev_agent(_load_prompt("dev_workflow_code_reviewer_system")) if team_mode else ""
    )

    async def node_prompt_enricher(state: DevWorkflowState) -> dict[str, Any]:
        """Produtifica pedidos vagos/curtos sem bloquear alterações incrementais."""
        trace = truncate_trace(list(state.get("trace") or []))
        team_traces = dict(state.get("team_traces") or {})
        msgs = state.get("messages") or []
        raw = build_raw_user_prompt(msgs)
        compile_attempt = int(state.get("compile_attempt") or 0)

        if not should_enrich(state, raw) or compile_attempt > 0:
            return {
                "raw_user_prompt": raw,
                "user_prompt": raw,
                "enrichment_skipped": True,
                "trace": trace + ["prompt_enricher:skip"],
                "team_traces": team_traces,
            }

        short_history = tail_messages(msgs, 14)
        short_history_json = json.dumps(short_history, ensure_ascii=False)[:8000]

        if team_mode:
            team_out = await run_prompt_enricher_team(
                settings,
                dict(state),
                enricher_sys=enricher_sys,
                prompt_reviewer_sys=prompt_reviewer_sys,
                raw=raw,
                short_history_json=short_history_json,
                max_rounds=max_review_rounds,
            )
            enriched = team_out["enriched"]
            team_traces["prompt"] = team_out["trace"]
            review = team_out.get("review") or {}
            return {
                "raw_user_prompt": raw,
                "enriched_prompt": enriched.get("full_prompt") or raw,
                "enriched_brief": {
                    "objective": enriched.get("objective") or "",
                    "audience": enriched.get("audience") or "",
                    "sections": enriched.get("sections") or [],
                    "tone": enriched.get("tone") or "",
                    "palette_hint": enriched.get("palette_hint") or "",
                    "layout_shell": enriched.get("layout_shell") or "marketing",
                },
                "user_prompt": str(enriched.get("full_prompt") or raw)[:4000],
                "enrichment_skipped": False,
                "prompt_review": review,
                "team_traces": team_traces,
                "team_rounds": {
                    **(state.get("team_rounds") or {}),
                    "prompt": team_out.get("rounds", 1),
                },
                "trace": trace + ["prompt_enricher:team"],
            }

        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = "## Pedido cru\n" + raw[:4000] + "\n\n## Histórico curto\n" + short_history_json
        resp = await chat.ainvoke(
            [SystemMessage(content=enricher_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        enriched = normalize_enriched_prompt(data, raw=raw)
        return {
            "raw_user_prompt": raw,
            "enriched_prompt": enriched.get("full_prompt") or raw,
            "enriched_brief": {
                "objective": enriched.get("objective") or "",
                "audience": enriched.get("audience") or "",
                "sections": enriched.get("sections") or [],
                "tone": enriched.get("tone") or "",
                "palette_hint": enriched.get("palette_hint") or "",
                "layout_shell": enriched.get("layout_shell") or "marketing",
            },
            "user_prompt": str(enriched.get("full_prompt") or raw)[:4000],
            "enrichment_skipped": False,
            "trace": trace + ["prompt_enricher"],
            "team_traces": team_traces,
        }

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
                "request_kind": "bug_fix",
                "affected_layers": state.get("affected_layers") or "fullstack",
                "stack_hint": state.get("stack_hint"),
                "stack_source": state.get("stack_source") or "retry_preserve",
                "stack_defaulted": bool(state.get("stack_defaulted")),
                "route_confidence": 1.0,
                "route_reason": "retry pós-compilador",
                "style_guide": state.get("style_guide") or {},
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
        has_project = bool(str(state.get("workspace_id") or "").strip()) or bool(
            state.get("project_files"),
        )
        has_build_errors = bool(
            (state.get("preview_console_block") or "").strip()
            or (state.get("compile_log") or "").strip()
        )
        parsed = parse_router_response(
            data,
            user_prompt=str(state.get("user_prompt") or ""),
            has_project=has_project,
            has_build_errors=has_build_errors,
            compact_stack=str((state.get("compact_context_map") or {}).get("stack") or ""),
            manifest_paths=[
                str(r.get("path", ""))
                for r in (state.get("file_manifest") or [])
                if isinstance(r, dict) and r.get("path")
            ],
        )

        trace_suffix = (
            f"router:{parsed['route']}:{parsed.get('request_kind')}:{parsed['affected_layers']}"
        )
        if rag_update.get("rag_relevant_paths"):
            trace_suffix += f":rag{len(rag_update['rag_relevant_paths'])}"

        brief = (
            state.get("enriched_brief") if isinstance(state.get("enriched_brief"), dict) else None
        )
        style_guide = retrieve_style_guide(str(state.get("user_prompt") or ""), brief)

        return {
            **parsed,
            **rag_update,
            "style_guide": style_guide,
            "trace": trace + [f"{trace_suffix}:style:{style_guide.get('domain')}"],
        }

    async def node_architect(state: DevWorkflowState) -> dict[str, Any]:
        trace = truncate_trace(list(state.get("trace") or []))
        team_traces = dict(state.get("team_traces") or {})
        manifest_paths = [
            str(r.get("path", ""))
            for r in (state.get("file_manifest") or [])
            if isinstance(r, dict) and r.get("path")
        ]
        style_guide = state.get("style_guide") or {}
        style_tokens = design_tokens_from_style_guide(style_guide)
        style_block = build_style_guide_block(style_guide)

        # Code RAG focado no plano (reusa bloco do router se já recuperado).
        arch_rag_block = str(state.get("rag_context_block") or "")
        if not arch_rag_block:
            project_id = stable_project_id(dict(state))
            arch_rag_block, _ = await retrieve_for_architect(
                settings,
                project_id,
                str(state.get("user_prompt") or ""),
                feature_summary=str(state.get("feature_summary") or ""),
            )

        human = (
            _prompt_bundle(state)
            + _request_kind_codegen_directive(str(state.get("request_kind") or ""))
            + build_architect_human_suffix(state)
            + (f"\n\n{style_block}" if style_block else "")
            + (f"\n\n{arch_rag_block}" if arch_rag_block else "")
        )
        layer = state.get("affected_layers") or "fullstack"

        def normalize_plan_fn(data: dict[str, Any]) -> dict[str, Any]:
            # O Architect usa o style_guide para preencher design_tokens quando o
            # LLM não os fornece (o LLM tem prioridade quando os define).
            if style_tokens and not data.get("design_tokens"):
                data = {**data, "design_tokens": style_tokens}
            data = merge_execution_plan_into_targets(dict(state), data)
            return normalize_architect_plan(
                data,
                affected_layers=layer,  # type: ignore[arg-type]
                stack_hint=state.get("stack_hint"),
                user_prompt=str(state.get("user_prompt") or ""),
                manifest_paths=manifest_paths,
                compact_context_map=state.get("compact_context_map") or {},
                rag_relevant_paths=list(state.get("rag_relevant_paths") or []),
            )

        if team_mode:
            team_out = await run_architect_team(
                settings,
                dict(state),
                architect_sys=architect_sys,
                plan_reviewer_sys=plan_reviewer_sys,
                human_base=human,
                normalize_plan_fn=normalize_plan_fn,
                max_rounds=max_review_rounds,
            )
            plan = team_out["plan"]
            team_traces["plan"] = team_out["trace"]
            return {
                "plan": plan,
                "plan_review": team_out.get("review") or {},
                "plan_approved": bool((team_out.get("review") or {}).get("approved")),
                "team_traces": team_traces,
                "trace": trace + [f"architect:team:{len(plan.get('targets') or [])}files"],
            }

        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        resp = await chat.ainvoke(
            [SystemMessage(content=architect_sys), HumanMessage(content=human)],
        )
        data = _parse_json_object(str(resp.content))
        plan = normalize_plan_fn(data)
        return {"plan": plan, "trace": trace + [f"architect:{len(plan.get('targets') or [])}files"]}

    async def node_orchestrator(state: DevWorkflowState) -> dict[str, Any]:
        """Decompõe plano aprovado em build_tasks ordenadas (time)."""
        trace = truncate_trace(list(state.get("trace") or []))
        team_traces = dict(state.get("team_traces") or {})
        plan = state.get("plan") or {}

        if not team_mode:
            tasks = build_tasks_from_plan(
                {**plan, "_project_files": state.get("project_files") or {}}
            )
            return {
                "build_tasks": tasks,
                "orchestration": {"skipped": True},
                "trace": trace + ["orchestrator:skip"],
            }

        team_out = await run_orchestrator_team(
            settings,
            dict(state),
            orchestrator_sys=orchestrator_sys,
            max_rounds=max_review_rounds,
        )
        team_traces["orchestrator"] = team_out["trace"]
        return {
            "build_tasks": team_out["build_tasks"],
            "orchestration": {
                "approved": bool((team_out.get("review") or {}).get("approved")),
                "notes": team_out.get("notes") or "",
            },
            "team_traces": team_traces,
            "trace": trace + [f"orchestrator:{len(team_out['build_tasks'])}tasks"],
        }

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
                str(d.get("rationale", "")).strip() for d in diff_instructions if d.get("rationale")
            ]
            assistant = "Apliquei as alterações pedidas no preview (modo patch)." + (
                f" {rationales[0][:200]}" if rationales else ""
            )
            valid, verr = validate_polvo_code_operations(prebuilt)
            meta = build_polvo_code_ops_metadata(
                bool(valid),
                valid,
                verr,
                create_project=False,
                npm_install=any(str(o.get("path", "")).endswith("package.json") for o in valid),
            )
            meta["dev_workflow"] = {
                "stack": (state.get("compact_context_map") or {}).get("stack"),
                "route": state.get("route"),
                "request_kind": str(state.get("request_kind") or "") or None,
                "compile_attempt": state.get("compile_attempt") or 0,
                "edit_mode": "diff_patch",
            }
            return {
                "pending_writes": [
                    {"op": o["op"], "path": o["path"], "content": o.get("content")} for o in valid
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
                errors[:8],
                ensure_ascii=False,
            )
        tokens = plan.get("design_tokens") if isinstance(plan, dict) else {}
        tokens_block = ""
        if tokens:
            tokens_block = (
                "\n\n## Design Tokens (OBRIGATÓRIO — aplicar em todo JSX/CSS gerado)\n"
                + json.dumps(tokens, ensure_ascii=False, indent=2)
                + "\n"
            )
        build_tasks = state.get("build_tasks") or []
        tasks_block = ""
        if build_tasks:
            tasks_block = (
                f"\n\n## Tarefas ordenadas\n{json.dumps(build_tasks, ensure_ascii=False)[:4000]}\n"
            )
        kind_block = _request_kind_codegen_directive(str(state.get("request_kind") or ""))
        style_guide_block = build_style_guide_block(state.get("style_guide") or {})
        style_block = f"{style_sys}\n\n{style_guide_block}" if style_guide_block else style_sys

        # Code RAG por-tarefa: contexto extra focado nos ficheiros a modificar.
        codegen_rag_block = ""
        modify_targets = [str(p) for p in (plan.get("files_to_modify") or []) if p][:2]
        if modify_targets and not state.get("rag_context_block"):
            project_id = stable_project_id(dict(state))
            for target in modify_targets:
                block, _ = await retrieve_for_codegen_task(
                    settings,
                    project_id,
                    target,
                    feature_summary=str(state.get("feature_summary") or ""),
                )
                if block:
                    codegen_rag_block += f"\n\n{block}"

        human = (
            _prompt_bundle(state)
            + kind_block
            + (f"\n\n{style_block}" if style_block else "")
            + build_agent_context_block(dict(state))
            + f"\n\n## Plano (Architect — só estes ficheiros)\n"
            f"criar: {json.dumps(plan.get('files_to_create') or [], ensure_ascii=False)}\n"
            f"modificar: {json.dumps(plan.get('files_to_modify') or [], ensure_ascii=False)}\n"
            f"rotas backend: {json.dumps(plan.get('backend_routes') or [], ensure_ascii=False)[:2000]}\n"
            + tokens_block
            + tasks_block
            + "\n\n## Excertos numerados (ancorar old_text)\n"
            + build_codegen_file_excerpts(plan, project_files)
            + (state.get("rag_context_block") or "")
            + codegen_rag_block
            + err_block
        )

        team_traces = dict(state.get("team_traces") or {})
        team_out: dict[str, Any] = {}
        if team_mode:
            team_out = await run_fullstack_codegen_team(
                settings,
                dict(state),
                codegen_sys=codegen_sys,
                code_reviewer_sys=code_reviewer_sys,
                human_base=human,
                project_files=project_files,
                plan=plan if isinstance(plan, dict) else {},
                max_rounds=max_review_rounds,
            )
            result = team_out["result"]
            data = result.get("data") or {}
            valid = result.get("polvo_code_ops") or []
            verr = result.get("validation_errors") or []
            team_traces["code"] = team_out["trace"]
        else:
            resp = await chat.ainvoke(
                [SystemMessage(content=codegen_sys), HumanMessage(content=human)],
            )
            data = _parse_json_object(str(resp.content))
            ops_raw = data.get("operations")
            if not isinstance(ops_raw, list):
                ops_raw = []
            from openpolvointeligence.graphs.dev_workflow.tools.file_output_parser import (
                ops_from_llm_output,
            )

            ops_raw = ops_from_llm_output(str(resp.content), ops_raw)
            plan_dict = plan if isinstance(plan, dict) else {}
            resolved, resolve_errs = resolve_codegen_operations(
                ops_raw,
                project_files,
                plan_dict,
            )
            if not resolved and plan_dict.get("files_to_modify"):
                resolved_loose, loose_errs = resolve_codegen_operations(
                    ops_raw,
                    project_files,
                    {},
                )
                if len(resolved_loose) > len(resolved):
                    resolved = resolved_loose
                    resolve_errs = resolve_errs + loose_errs
            valid, verr = validate_polvo_code_operations(resolved)
            verr = verr + resolve_errs

        pending: list[dict[str, Any]] = [
            {"op": o["op"], "path": o["path"], "content": o.get("content")} for o in valid
        ]
        assistant = str(data.get("assistant_reply") or "").strip()
        if not assistant:
            assistant = "Estou a actualizar o preview com as alterações pedidas."

        request_kind = str(state.get("request_kind") or "")
        has_workspace = bool(str(state.get("workspace_id") or "").strip())
        # create_project só quando é mesmo nova app (sem workspace) — não basta o LLM dizer.
        create_project_flag = (
            create_project_for_kind(request_kind, has_workspace=has_workspace)
            if request_kind
            else bool(data.get("create_project"))
        )
        if not request_kind and not has_workspace and bool(data.get("create_project")):
            create_project_flag = True
        plan_dict = plan if isinstance(plan, dict) else {}
        existing_paths = (
            {str(k).replace("\\", "/") for k in project_files}
            if isinstance(project_files, dict)
            else set()
        )
        meta = build_polvo_code_ops_metadata(
            bool(valid),
            valid,
            verr,
            create_project=create_project_flag,
            project_title=str(data.get("project_title") or "").strip() or None,
            npm_install=bool(data.get("npm_install")) or create_project_flag,
            has_workspace=has_workspace,
            stack=str(plan_dict.get("stack") or state.get("stack_hint") or "") or None,
            design_tokens=(
                plan_dict.get("design_tokens")
                if isinstance(plan_dict.get("design_tokens"), dict)
                else None
            ),
            existing_paths=existing_paths,
        )
        # Deriva modo de edição a partir do que efectivamente foi escrito no projecto.
        created = 0
        modified = 0
        for o in valid:
            if not isinstance(o, dict):
                continue
            if o.get("op") != "write":
                continue
            p = str(o.get("path") or "").strip().replace("\\", "/").lstrip("/")
            if not p:
                continue
            existed = bool(project_files.get(p))
            if existed:
                modified += 1
            else:
                created += 1
        derived_mode = "patch"
        if created and modified:
            derived_mode = "mixed"
        elif created:
            derived_mode = "create"
        elif modified:
            derived_mode = "modify"
        style_guide = state.get("style_guide") or {}
        meta["dev_workflow"] = {
            "stack": plan.get("stack") if isinstance(plan, dict) else None,
            "stack_source": state.get("stack_source"),
            "stack_defaulted": bool(state.get("stack_defaulted")),
            "route": state.get("route"),
            "request_kind": request_kind or None,
            "compile_attempt": state.get("compile_attempt") or 0,
            "edit_mode": derived_mode,
            "design_tokens": (
                plan.get("design_tokens")
                if isinstance(plan, dict) and plan.get("design_tokens")
                else None
            ),
            "style_guide": style_guide or None,
            "team_mode": team_mode,
        }

        trace_suffix = "code_generator:team" if team_mode else "code_generator"
        out: dict[str, Any] = {
            "pending_writes": pending,
            "polvo_code_ops": valid,
            "assistant_text": assistant,
            "metadata": meta,
            "code_review": team_out.get("review") if team_mode else {},
            "code_approved": bool((team_out.get("review") or {}).get("approved"))
            if team_mode
            else True,
            "team_traces": team_traces,
            "trace": trace + [trace_suffix],
        }
        updated_files = dict(project_files)
        for w in pending:
            if w.get("op") == "write" and w.get("path"):
                updated_files[str(w["path"])] = str(w.get("content") or "")
        if team_mode:
            out["project_files"] = updated_files
        # Re-indexa o snapshot gerado para o retrieval ver a versão mais recente.
        if settings.code_rag_auto_index and pending:
            await reindex_project_files(settings, stable_project_id(dict(state)), updated_files)
        return out

    async def node_static_verify(state: DevWorkflowState) -> dict[str, Any]:
        """Virtual build determinístico antes do compiler_checker."""
        trace = truncate_trace(list(state.get("trace") or []))
        project_files = dict(state.get("project_files") or {})
        pending = list(state.get("pending_writes") or [])
        sv = run_static_verify(project_files, pending_writes=pending)

        result: dict[str, Any] = {
            "static_verify": sv,
            "trace": trace + [f"static_verify:{'ok' if sv.get('ok') else 'fail'}"],
        }
        if not sv.get("ok"):
            result["error_digest"] = sv.get("error_digest") or []
            result["compile_attempt"] = int(state.get("compile_attempt") or 0) + 1
        return result

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

    async def node_build_sandbox(state: DevWorkflowState) -> dict[str, Any]:
        """Build real (tsc/vite) num sandbox — portão anti-bug. Degrade graciosamente."""
        trace = truncate_trace(list(state.get("trace") or []))
        project_files = dict(state.get("project_files") or {})
        for w in state.get("pending_writes") or []:
            if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
                key = str(w["path"]).replace("\\", "/").lstrip("/")
                project_files[key] = str(w.get("content") or "")

        result = await run_build_sandbox(settings, project_files)

        meta = dict(state.get("metadata") or {})
        dw = dict(meta.get("dev_workflow") or {})
        dw["build_result"] = result
        meta["dev_workflow"] = dw

        suffix = (
            f"build_sandbox:{'ok' if result.get('ok') else 'fail'}:"
            f"{'ran' if result.get('ran') else 'skip'}"
        )
        out: dict[str, Any] = {
            "build_result": result,
            "metadata": meta,
            "trace": trace + [suffix],
        }
        if not result.get("ok"):
            out["compile_ok"] = False
            out["error_digest"] = build_errors_to_digest(result.get("errors") or [])
            out["compile_attempt"] = int(state.get("compile_attempt") or 0) + 1
        return out

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

        if not merged_log.strip() and not error_digest:
            static_sv = state.get("static_verify") or {}
            if isinstance(static_sv, dict) and static_sv.get("error_digest"):
                error_digest = list(static_sv.get("error_digest") or [])
            else:
                return {"trace": trace + ["self_healer:skip"]}

        if not merged_log.strip() and error_digest:
            merged_log = json.dumps(error_digest, ensure_ascii=False)

        project_id = stable_project_id(dict(state))
        recalled = await recall_similar_errors(settings, project_id, list(error_digest))
        error_memory_block = build_error_memory_block(recalled)

        heal = await run_self_heal(
            settings,
            state.get("model_provider"),
            user_prompt=str(state.get("user_prompt") or ""),
            compile_log=merged_log,
            error_digest=list(error_digest),
            project_files=project_files,
            plan=plan,
            error_memory_block=error_memory_block,
        )
        valid = heal.get("polvo_code_ops") or []
        pending = heal.get("pending_writes") or []
        updated_files = apply_heal_to_project_files(project_files, valid)

        # Memoriza o par erro→fix e re-indexa o snapshot corrigido.
        heal_summary = str(heal.get("heal_summary") or "").strip()
        if valid and heal_summary:
            await index_error_fix(
                settings,
                project_id,
                error_digest=list(error_digest),
                fix_summary=heal_summary,
                root_cause=str(
                    (heal.get("metadata") or {}).get("dev_workflow", {}).get("root_cause") or ""
                ),
            )
        if settings.code_rag_auto_index and valid:
            await reindex_project_files(settings, project_id, updated_files)

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
        explain_sys = _with_dev_agent(
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
                f"Não consigo avançar com esse pedido no estúdio de desenvolvimento. {reason}"
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

    g.add_node("prompt_enricher", node_prompt_enricher)
    g.add_node("context_manager", node_context_manager)
    g.add_node("router", node_router)
    g.add_node("architect", node_architect)
    g.add_node("orchestrator", node_orchestrator)
    g.add_node("code_generator", node_code_generator)
    g.add_node("static_verify", node_static_verify)
    g.add_node("compiler_checker", node_compiler_checker)
    g.add_node("build_sandbox", node_build_sandbox)
    g.add_node("self_healer", node_self_healer)
    g.add_node("explain", node_explain)
    g.add_node("abort", node_abort)
    g.add_node("context_finalize", node_context_finalize)

    g.add_edge(START, "prompt_enricher")
    g.add_edge("prompt_enricher", "context_manager")
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
    if team_mode:
        g.add_edge("architect", "orchestrator")
        g.add_edge("orchestrator", "code_generator")
        g.add_edge("code_generator", "static_verify")
        g.add_conditional_edges(
            "static_verify",
            route_after_static_verify,
            {
                "compiler_checker": "compiler_checker",
                "retry_self_heal": "self_healer",
            },
        )
    else:
        g.add_edge("architect", "code_generator")
        g.add_edge("code_generator", "compiler_checker")
    g.add_conditional_edges(
        "compiler_checker",
        route_after_compiler,
        {
            "build_sandbox": "build_sandbox",
            "context_finalize": "context_finalize",
            "retry_self_heal": "self_healer",
        },
    )
    g.add_conditional_edges(
        "build_sandbox",
        route_after_build_sandbox,
        {
            "context_finalize": "context_finalize",
            "retry_self_heal": "self_healer",
        },
    )
    g.add_edge("self_healer", "compiler_checker" if not team_mode else "static_verify")
    g.add_edge("explain", END)
    g.add_edge("abort", END)
    g.add_edge("context_finalize", END)

    return g.compile()


_compiled: Any = None
_compiled_settings_key: tuple[bool, int] | None = None


def get_dev_workflow_graph(settings: Settings) -> Any:
    global _compiled, _compiled_settings_key
    key = (
        bool(getattr(settings, "dev_workflow_team_mode", True)),
        int(getattr(settings, "dev_workflow_max_review_rounds", 3) or 3),
    )
    if _compiled is None or _compiled_settings_key != key:
        _compiled = build_dev_workflow_graph(settings)
        _compiled_settings_key = key
    return _compiled


def reset_dev_workflow_graph_cache() -> None:
    global _compiled, _compiled_settings_key
    _compiled = None
    _compiled_settings_key = None


from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import (  # noqa: E402, F401
    _merge_project_files_state,
    _stable_project_id_for_pipeline,
    run_dev_workflow_pipeline,
    run_dev_workflow_stream,
)

__all__ = [
    "build_dev_workflow_graph",
    "get_dev_workflow_graph",
    "reset_dev_workflow_graph_cache",
    "route_after_router",
    "route_after_compiler",
    "route_after_build_sandbox",
    "route_after_static_verify",
    "run_dev_workflow_pipeline",
    "run_dev_workflow_stream",
    "_stable_project_id_for_pipeline",
    "_merge_project_files_state",
]
