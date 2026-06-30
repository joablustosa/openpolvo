"""Loop ReAct do DevAgent — exploração, edição e conclusão (paridade Cursor)."""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.core.dev_agent_prompts import (
    inject_dev_agent_system,
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
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    build_terminal_port,
    get_terminal_port,
)
from openpolvointeligence.graphs.models import get_chat_model

_logger = logging.getLogger(__name__)

DEFAULT_MAX_ITERATIONS = 20


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


def _parse_action(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"action": "error", "detail": "JSON inválido"}
    return data if isinstance(data, dict) else {}


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
    return "Responde em JSON com action tool ou done."


def _merge_ops(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_path: dict[str, dict[str, Any]] = {}
    for op in existing + new:
        if not isinstance(op, dict):
            continue
        path = str(op.get("path") or "")
        if path:
            by_path[path] = op
    return list(by_path.values())


async def run_agent_loop(
    settings: Settings,
    state: dict[str, Any],
    *,
    max_iterations: int | None = None,
) -> dict[str, Any]:
    """Executa o loop agentico até done ou limite de iterações."""
    max_iter = max_iterations or int(
        getattr(settings, "dev_workflow_agent_loop_max_iterations", DEFAULT_MAX_ITERATIONS)
        or DEFAULT_MAX_ITERATIONS
    )
    project_files = dict(state.get("project_files") or {})
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            project_files[str(w["path"])] = str(w.get("content") or "")

    port = get_terminal_port() or build_terminal_port(settings, dict(state))
    ctx = build_hierarchical_context(state, agent_key="agent_loop")
    system = inject_dev_agent_system(_load_agent_loop_system())
    provider = state.get("model_provider")
    chat = get_chat_model(settings, provider, json_mode=True)

    prompt = str(state.get("enriched_prompt") or state.get("user_prompt") or "")
    plan = state.get("execution_plan") or state.get("plan") or {}
    plan_block = ""
    if isinstance(plan, dict) and plan:
        plan_block = f"\n\n## Plano\n{json.dumps(plan, ensure_ascii=False)[:3000]}"

    observations: list[str] = []
    all_ops: list[dict[str, Any]] = []
    trace: list[str] = list(state.get("trace") or [])
    agent_events: list[dict[str, Any]] = list(state.get("agent_events") or [])
    assistant_reply = ""

    for i in range(max_iter):
        human_parts = [
            f"## Pedido\n{prompt[:4000]}",
            ctx.get("context_block") or "",
            plan_block,
        ]
        if observations:
            human_parts.append("## Observações anteriores\n" + "\n---\n".join(observations[-8:]))
        human = "\n\n".join(p for p in human_parts if p)

        try:
            resp = await chat.ainvoke(
                [SystemMessage(content=system), HumanMessage(content=human)],
            )
        except Exception as exc:
            _logger.warning("agent_loop LLM falhou: %s", exc)
            break

        action = _parse_action(str(resp.content))
        act = str(action.get("action") or "").lower()
        trace.append(f"agent_loop:{i + 1}:{act}")

        if act == "done":
            assistant_reply = str(action.get("assistant_reply") or "").strip()
            ops_raw = action.get("operations") or []
            if isinstance(ops_raw, list):
                valid, _ = validate_polvo_code_operations(
                    [o for o in ops_raw if isinstance(o, dict)],
                )
                all_ops = _merge_ops(all_ops, valid)
            break

        if act == "tool":
            tool = str(action.get("tool") or "")
            args = action.get("args") if isinstance(action.get("args"), dict) else {}
            thought = str(action.get("thought") or "")[:200]
            agent_events.append(
                {"type": "tool_call", "tool": tool, "args": args, "thought": thought},
            )
            obs, project_files, partial_ops = await execute_agent_tool(
                settings,
                state,
                tool,
                args,
                project_files=project_files,
                port=port,
            )
            all_ops = _merge_ops(all_ops, partial_ops)
            observations.append(f"[{tool}] {obs[:2000]}")
            agent_events.append({"type": "tool_result", "tool": tool, "preview": obs[:500]})
            continue

        observations.append(f"[parse_error] {action.get('detail', 'acção inválida')}")
        if i >= max_iter - 1:
            break

    valid_ops, verr = validate_polvo_code_operations(all_ops)
    complete = bool(valid_ops) and not verr
    pending = [
        {"op": o.get("op"), "path": o.get("path"), "content": o.get("content")}
        for o in valid_ops
    ]

    return {
        "project_files": project_files,
        "polvo_code_ops": valid_ops,
        "pending_writes": pending,
        "assistant_text": assistant_reply or state.get("assistant_text"),
        "agent_loop_complete": complete,
        "skip_legacy_core": complete,
        "agent_loop_iterations": len(trace),
        "agent_loop_observations": observations[-20:],
        "tool_observations": observations,
        "trace": trace,
        "agent_events": agent_events,
        "use_diff_mode": True,
        "route": "patch",
        "context_block": ctx.get("context_block"),
        "compact_context_map": ctx.get("compact_context_map"),
    }
