"""Grafo LangGraph: agente especialista de automações/workflows.

Pipeline: analyze_intent → enrich_brief → design_steps → compose_graph →
validate_graph → finalize. Enriquece o pedido do utilizador, desenha passos
(cada um com o seu prompt) e produz um GraphJSON executável pelo backend.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import effective_provider, get_chat_model
from openpolvointeligence.graphs.workflow_builder.workflow_specialist_prompt_logic import (
    graph_to_raw_json,
    normalize_brief,
    normalize_steps,
    parse_json_block,
    steps_to_graph,
    validate_graph,
)
from openpolvointeligence.graphs.workflow_builder.workflow_specialist_state import WorkflowSpecialistState

_logger = logging.getLogger(__name__)
_PROMPTS = Path(__file__).resolve().parent.parent.parent / "prompts" / "workflow_specialist"


def _load_prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _format_chat_reply(brief: dict[str, Any], steps: list[dict[str, Any]]) -> str:
    title = str(brief.get("title") or "Automação")
    lines = [
        f"## {title}",
        "",
        str(brief.get("description") or "Automação criada com sucesso."),
        "",
        f"**Gatilho:** {brief.get('trigger', 'manual')}",
        f"**Passos:** {len(steps)}",
    ]
    integrations = brief.get("integrations") or []
    if integrations:
        lines.append(f"**Integrações:** {', '.join(str(i) for i in integrations)}")
    lines.extend(["", "### Fluxo desenhado", ""])
    for i, step in enumerate(steps, start=1):
        label = step.get("label") or step.get("type")
        prompt = step.get("prompt") or ""
        lines.append(f"{i}. **{label}** (`{step.get('type')}`)")
        if prompt:
            lines.append(f"   - {prompt}")
    assumptions = brief.get("assumptions") or []
    if assumptions:
        lines.extend(["", "### Premissas", ""])
        lines.extend(f"- {a}" for a in assumptions)
    lines.extend(
        [
            "",
            "O fluxo abaixo abre no editor visual. Clique num passo para ver ou ajustar o seu prompt, "
            "ou descreva no chat as alterações que pretende.",
        ]
    )
    return "\n".join(lines)


def build_workflow_specialist_graph(settings: Settings) -> Any:
    analyze_sys = _load_prompt("analyze_intent_system")
    enrich_sys = _load_prompt("enrich_brief_system")
    steps_sys = _load_prompt("design_steps_system")

    async def node_analyze_intent(state: WorkflowSpecialistState) -> dict[str, Any]:
        raw = state.get("user_query") or ""
        hint = state.get("recording_hint") or ""
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = f"PEDIDO DO UTILIZADOR:\n{raw}"
        if hint.strip():
            human += f"\n\nCONTEXTO ADICIONAL:\n{hint}"
        human += "\n\nDevolve o JSON da análise da intenção."
        resp = await chat.ainvoke(
            [SystemMessage(content=analyze_sys), HumanMessage(content=human)],
        )
        intent = parse_json_block(str(resp.content))
        trace = list(state.get("trace") or []) + ["analyze_intent"]
        return {"automation_brief": intent, "trace": trace}

    async def node_enrich_brief(state: WorkflowSpecialistState) -> dict[str, Any]:
        raw = state.get("user_query") or ""
        intent = state.get("automation_brief") or {}
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = (
            f"PEDIDO ORIGINAL:\n{raw}\n\n"
            f"ANÁLISE DA INTENÇÃO:\n{intent}\n\n"
            "Devolve o JSON do brief enriquecido."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=enrich_sys), HumanMessage(content=human)],
        )
        brief = normalize_brief(parse_json_block(str(resp.content)), raw=raw)
        trace = list(state.get("trace") or []) + ["enrich_brief"]
        return {"automation_brief": brief, "trace": trace}

    async def node_design_steps(state: WorkflowSpecialistState) -> dict[str, Any]:
        brief = state.get("automation_brief") or {}
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        human = (
            f"BRIEF DO AGENTE:\n{brief}\n\n"
            f"PEDIDO ORIGINAL:\n{state.get('user_query') or ''}\n\n"
            "Desenha os passos da automação. Devolve o JSON com a lista de steps."
        )
        resp = await chat.ainvoke(
            [SystemMessage(content=steps_sys), HumanMessage(content=human)],
        )
        parsed = parse_json_block(str(resp.content))
        steps = normalize_steps(parsed.get("steps"))
        trace = list(state.get("trace") or []) + ["design_steps"]
        return {"step_blueprint": steps, "trace": trace}

    async def node_compose_graph(state: WorkflowSpecialistState) -> dict[str, Any]:
        steps = state.get("step_blueprint") or []
        graph = steps_to_graph(steps)
        trace = list(state.get("trace") or []) + ["compose_graph"]
        return {"graph_json": graph, "trace": trace}

    async def node_validate_graph(state: WorkflowSpecialistState) -> dict[str, Any]:
        graph = state.get("graph_json") or {"nodes": [], "edges": []}
        clean, notes = validate_graph(graph)
        trace = list(state.get("trace") or []) + ["validate_graph"]
        return {
            "graph_json": clean,
            "validation_notes": notes,
            "raw_llm": graph_to_raw_json(clean),
            "trace": trace,
        }

    async def node_finalize(state: WorkflowSpecialistState) -> dict[str, Any]:
        brief = state.get("automation_brief") or {}
        steps = state.get("step_blueprint") or []
        graph = state.get("graph_json") or {"nodes": [], "edges": []}
        mp = effective_provider(state.get("model_provider"))
        assistant_text = _format_chat_reply(brief, steps)
        meta = {
            "document_kind": "workflow_automation",
            "intent": "workflow_specialist",
            "routed_intent": "workflow_specialist",
            "model_provider": mp,
            "workflow_specialist": {
                "brief": brief,
                "step_blueprint": steps,
                "validation_notes": state.get("validation_notes") or [],
                "trace": state.get("trace") or [],
            },
            "workflow_graph": graph,
        }
        trace = list(state.get("trace") or []) + ["finalize"]
        return {"assistant_text": assistant_text, "metadata": meta, "trace": trace}

    g = StateGraph(WorkflowSpecialistState)
    g.add_node("analyze_intent", node_analyze_intent)
    g.add_node("enrich_brief", node_enrich_brief)
    g.add_node("design_steps", node_design_steps)
    g.add_node("compose_graph", node_compose_graph)
    g.add_node("validate_graph", node_validate_graph)
    g.add_node("finalize", node_finalize)
    g.add_edge(START, "analyze_intent")
    g.add_edge("analyze_intent", "enrich_brief")
    g.add_edge("enrich_brief", "design_steps")
    g.add_edge("design_steps", "compose_graph")
    g.add_edge("compose_graph", "validate_graph")
    g.add_edge("validate_graph", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


_compiled: Any = None


def get_workflow_specialist_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_workflow_specialist_graph(settings)
    return _compiled


def reset_workflow_specialist_graph_cache() -> None:
    global _compiled
    _compiled = None


async def run_workflow_specialist(
    settings: Settings,
    model_provider: str | None,
    user_request: str,
    recording_hint: str = "",
) -> dict[str, Any]:
    """Executa o pipeline e devolve raw_llm (grafo), brief, steps e assistant_text."""
    graph = get_workflow_specialist_graph(settings)
    out = await graph.ainvoke(
        {
            "model_provider": model_provider,
            "user_query": user_request,
            "recording_hint": recording_hint,
            "trace": [],
        },
    )
    return {
        "raw_llm": str(out.get("raw_llm") or ""),
        "graph_json": out.get("graph_json") or {"nodes": [], "edges": []},
        "brief": out.get("automation_brief") or {},
        "step_blueprint": out.get("step_blueprint") or [],
        "assistant_text": str(out.get("assistant_text") or ""),
        "metadata": out.get("metadata") if isinstance(out.get("metadata"), dict) else {},
    }


_PROGRESS_LABELS: dict[str, str] = {
    "wf_analyze": "A analisar a intenção da automação…",
    "wf_enrich": "A enriquecer o brief do agente…",
    "wf_design": "A desenhar os passos do fluxo…",
    "wf_compose": "A montar o grafo visual…",
    "wf_validate": "A validar o fluxo…",
}

_NEXT_PROGRESS: dict[str, str] = {
    "analyze_intent": "wf_enrich",
    "enrich_brief": "wf_design",
    "design_steps": "wf_compose",
    "compose_graph": "wf_validate",
}


def _progress_event(step: str) -> dict[str, Any]:
    return {
        "type": "progress",
        "step": step,
        "label": _PROGRESS_LABELS[step],
        "payload": {"document_kind": "workflow_automation", "phase": step},
    }


async def run_workflow_specialist_stream(
    settings: Settings,
    model_provider: str | None,
    user_request: str,
    recording_hint: str = "",
) -> AsyncIterator[dict[str, Any]]:
    """Stream com eventos de progresso por fase + done com grafo em metadata."""
    graph = get_workflow_specialist_graph(settings)
    state_in: WorkflowSpecialistState = {
        "model_provider": model_provider,
        "user_query": user_request,
        "recording_hint": recording_hint,
        "trace": [],
    }
    yield _progress_event("wf_analyze")
    merged: dict[str, Any] = dict(state_in)
    try:
        async for chunk in graph.astream(state_in):
            for node_name, patch in chunk.items():
                if isinstance(patch, dict):
                    merged.update(patch)
                next_step = _NEXT_PROGRESS.get(node_name)
                if next_step:
                    yield _progress_event(next_step)
        yield {
            "type": "done",
            "assistant_text": str(merged.get("assistant_text") or ""),
            "metadata": merged.get("metadata") if isinstance(merged.get("metadata"), dict) else {},
            "raw_llm": str(merged.get("raw_llm") or ""),
        }
    except Exception as exc:
        _logger.exception("workflow_specialist pipeline failed")
        yield {
            "type": "done",
            "assistant_text": f"Não foi possível desenhar a automação. Detalhe: {str(exc)[:300]}",
            "metadata": {
                "intent": "workflow_specialist",
                "error_kind": "workflow_pipeline_failed",
                "model_provider": effective_provider(model_provider),
            },
            "raw_llm": "",
        }
