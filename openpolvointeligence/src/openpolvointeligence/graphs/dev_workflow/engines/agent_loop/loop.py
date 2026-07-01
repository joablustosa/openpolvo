"""Loop agentico do DevAgent — histórico persistente + tool-use híbrido (paridade Claude Code).

Diferença central face à versão antiga: mantém-se **um único fio de mensagens**
(System → Human → Assistant(tool_calls) → Tool(results) → …) durante todo o loop, em
vez de reconstruir o prompt a cada iteração. O modelo vê o próprio raciocínio e os
resultados anteriores como turnos reais — deixa de repetir trabalho e de "esquecer".

O modo (tool-calling nativo vs. JSON) é resolvido pela ``ModelBridge``; este ficheiro
fica agnóstico ao provider e funciona igual com OpenAI/Gemini e com Ollama local.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import (
    inject_dev_agent_system,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.model_bridge import (
    ModelBridge,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.tools import (
    execute_agent_tool,
)
from openpolvointeligence.graphs.dev_workflow.engines.context.engine import (
    build_hierarchical_context,
)
from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow.runtime.events import get_event_store
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    build_terminal_port,
    get_terminal_port,
)

_logger = logging.getLogger(__name__)

DEFAULT_MAX_ITERATIONS = 20

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]

# Instruções por tipo de subagente (usadas quando o loop corre como delegação `task`).
_SUBAGENT_ROLES: dict[str, str] = {
    "explorer": (
        "És o subagente EXPLORER. Mapeia o código relevante com read_file/grep/glob/"
        "semantic_search e devolve um resumo preciso. NÃO escrevas ficheiros."
    ),
    "implementer": (
        "És o subagente IMPLEMENTER. Implementa a mudança pedida com edições mínimas e "
        "sem placeholders. Verifica antes de concluir."
    ),
    "reviewer": (
        "És o subagente REVIEWER. Revê o código quanto a bugs, segurança e qualidade; "
        "corrige o que for claramente incorrecto e resume as decisões."
    ),
    "tester": (
        "És o subagente TESTER. Escreve/corre testes relevantes e reporta falhas com "
        "o comando exacto usado."
    ),
}


def _load_agent_loop_system() -> str:
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[4]
        / "prompts"
        / "dev_agent"
        / "agent_loop_system.md"
    )
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return "És um agente de desenvolvimento. Usa ferramentas para explorar, editar e validar."


def _merge_ops(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_path: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for op in existing + new:
        if not isinstance(op, dict):
            continue
        path = str(op.get("path") or "")
        if not path:
            continue
        if path not in by_path:
            order.append(path)
        by_path[path] = op
    return [by_path[p] for p in order]


def _resolve_thread_id(state: dict[str, Any]) -> str:
    return str(
        state.get("thread_id")
        or state.get("conversation_id")
        or state.get("workspace_id")
        or "dev-agent",
    )


async def _emit_event(
    emit: EmitFn | None,
    thread_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Regista no EventStore (canal de polling já existente) e no callback de stream."""
    try:
        get_event_store().append(thread_id, event_type, payload)
    except Exception:  # noqa: BLE001 — telemetria nunca deve quebrar o loop
        pass
    if emit is not None:
        try:
            await emit(event_type, payload)
        except Exception:  # noqa: BLE001
            pass


def _build_system(state: dict[str, Any], bridge: ModelBridge) -> str:
    base = inject_dev_agent_system(_load_agent_loop_system())
    subtype = str(state.get("_subagent_type") or "").strip().lower()
    role = _SUBAGENT_ROLES.get(subtype, "")
    parts = [base]
    if role:
        parts.append(f"## Papel\n{role}")
    parts.append(bridge.system_suffix())
    return "\n\n".join(p for p in parts if p)


def _build_initial_human(state: dict[str, Any], ctx: dict[str, Any]) -> str:
    prompt = str(state.get("enriched_prompt") or state.get("user_prompt") or "")
    plan = state.get("execution_plan") or state.get("plan") or {}
    parts = [f"## Pedido\n{prompt[:6000]}"]
    ctx_block = ctx.get("context_block") or ""
    if ctx_block:
        parts.append(ctx_block)
    if isinstance(plan, dict) and plan:
        parts.append(f"## Plano\n{json.dumps(plan, ensure_ascii=False)[:3000]}")
    accept = state.get("acceptance_criteria")
    if isinstance(accept, list) and accept:
        crit = "\n".join(f"- {c}" for c in accept[:12])
        parts.append(f"## Critérios de aceitação\n{crit}")
    return "\n\n".join(parts)


async def run_agent_loop(
    settings: Settings,
    state: dict[str, Any],
    *,
    max_iterations: int | None = None,
    emit: EmitFn | None = None,
    depth: int = 0,
) -> dict[str, Any]:
    """Executa o loop agentico até o modelo concluir ou atingir o limite de iterações."""
    max_iter = max_iterations or int(
        getattr(settings, "dev_workflow_agent_loop_max_iterations", DEFAULT_MAX_ITERATIONS)
        or DEFAULT_MAX_ITERATIONS
    )

    project_files = dict(state.get("project_files") or {})
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            project_files[str(w["path"])] = str(w.get("content") or "")

    port = get_terminal_port()
    if port is None:
        port = build_terminal_port(settings, dict(state), bridge_wait=None, emit=None)

    # Canal de streaming ao vivo: reutiliza o `emit` do terminal port (ligado à fila SSE
    # em run_dev_workflow_stream), para que cada tool_call/file_applied chegue ao front
    # em tempo real, enquanto o nó ainda está a executar.
    if emit is None and getattr(port, "emit", None) is not None:
        emit = port.emit

    ctx = build_hierarchical_context(state, agent_key="agent_loop")
    bridge = ModelBridge(settings, state.get("model_provider"))
    thread_id = _resolve_thread_id(state)

    system = _build_system(state, bridge)
    messages: list[Any] = [
        SystemMessage(content=system),
        HumanMessage(content=_build_initial_human(state, ctx)),
    ]

    all_ops: list[dict[str, Any]] = []
    trace: list[str] = list(state.get("trace") or [])
    agent_events: list[dict[str, Any]] = list(state.get("agent_events") or [])
    observations: list[str] = []
    latest_todos: list[Any] = list(state.get("todos") or [])
    assistant_reply = ""

    await _emit_event(
        emit, thread_id, "agent_loop_start",
        {"mode": bridge.mode, "depth": depth, "max_iterations": max_iter},
    )

    for i in range(max_iter):
        try:
            decision = await bridge.decide(messages)
        except Exception as exc:  # noqa: BLE001
            _logger.warning("agent_loop LLM falhou: %s", exc)
            await _emit_event(emit, thread_id, "agent_loop_error", {"detail": str(exc)[:300]})
            break

        messages.append(decision.assistant_message)

        if decision.finished:
            assistant_reply = decision.final_text.strip()
            all_ops = _merge_ops(all_ops, decision.explicit_operations)
            trace.append(f"agent_loop:{i + 1}:done")
            break

        if not decision.tool_calls:
            # Sem tool calls e não concluído (parse falhou / modelo hesitou) — reorienta.
            messages.append(
                HumanMessage(
                    content=(
                        "Continua: usa uma ferramenta para avançar ou conclui a tarefa "
                        "conforme o protocolo."
                    ),
                ),
            )
            trace.append(f"agent_loop:{i + 1}:noop")
            continue

        for tc in decision.tool_calls:
            tool = str(tc.get("name") or "")
            args = tc.get("args") if isinstance(tc.get("args"), dict) else {}
            thought = str(args.get("thought") or "")[:200]
            trace.append(f"agent_loop:{i + 1}:{tool}")
            agent_events.append(
                {"type": "tool_call", "tool": tool, "args": args, "thought": thought},
            )
            await _emit_event(
                emit, thread_id, "tool_call", {"tool": tool, "args": _safe_args(args)},
            )

            obs, project_files, partial_ops = await execute_agent_tool(
                settings,
                {**state, "project_files": project_files},
                tool,
                args,
                project_files=project_files,
                port=port,
                depth=depth,
            )
            all_ops = _merge_ops(all_ops, partial_ops)
            observations.append(f"[{tool}] {obs[:2000]}")
            agent_events.append({"type": "tool_result", "tool": tool, "preview": obs[:500]})

            if tool.strip().lower() == "todo_write" and isinstance(args.get("todos"), list):
                latest_todos = args["todos"]
                await _emit_event(emit, thread_id, "todos", {"todos": latest_todos})

            for op in partial_ops:
                if isinstance(op, dict) and op.get("path"):
                    await _emit_event(
                        emit, thread_id, "file_applied",
                        {"op": op.get("op"), "path": op.get("path")},
                    )

            messages.append(bridge.tool_result_message(tc, obs))

    valid_ops, verr = validate_polvo_code_operations(all_ops)
    complete = bool(valid_ops) and not verr
    if not assistant_reply and complete:
        assistant_reply = f"Concluído: {len(valid_ops)} ficheiro(s) alterado(s)."
    pending = [
        {"op": o.get("op"), "path": o.get("path"), "content": o.get("content")}
        for o in valid_ops
    ]

    await _emit_event(
        emit, thread_id, "agent_loop_complete",
        {"complete": complete, "ops": len(valid_ops), "iterations": len(trace)},
    )

    # Sinaliza ao front que há um projecto executável: instalar deps (se package.json foi
    # tocado) e (re)abrir o preview ao vivo. A URL do dev-server é resolvida no front.
    if complete:
        touched = {str(o.get("path") or "") for o in valid_ops}
        needs_install = any(p.endswith("package.json") for p in touched)
        if needs_install or "package.json" in project_files:
            await _emit_event(
                emit, thread_id, "preview",
                {"action": "start_dev_server", "needs_install": needs_install},
            )

    return {
        "project_files": project_files,
        "polvo_code_ops": valid_ops,
        "pending_writes": pending,
        "assistant_text": assistant_reply or state.get("assistant_text"),
        "agent_loop_complete": complete,
        "skip_legacy_core": complete,
        "agent_loop_mode": bridge.mode,
        "agent_loop_iterations": len(trace),
        "agent_loop_observations": observations[-20:],
        "tool_observations": observations,
        "todos": latest_todos,
        "trace": trace,
        "agent_events": agent_events,
        "use_diff_mode": True,
        "route": "patch",
        "context_block": ctx.get("context_block"),
        "compact_context_map": ctx.get("compact_context_map"),
    }


def _safe_args(args: dict[str, Any]) -> dict[str, Any]:
    """Trunca conteúdos grandes antes de emitir para o stream."""
    out: dict[str, Any] = {}
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 300:
            out[k] = v[:300] + "…"
        else:
            out[k] = v
    return out
