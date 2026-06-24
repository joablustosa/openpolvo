"""Grafo LangGraph do Open Polvo Desk (M1 CORE-2/3)."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.agent_memory_utils import (
    format_agent_memory_block,
    truncate_memory_for_desk,
)
from openpolvointeligence.graphs.desk_state import DeskAgentState, truncate_trace
from openpolvointeligence.graphs.desk_tool_logic import desk_langchain_tools, dispatch_tool_calls
from openpolvointeligence.graphs.message_utils import tail_messages
from openpolvointeligence.graphs.email_send_reply import format_smtp_block_for_prompt
from openpolvointeligence.graphs.models import effective_provider, get_chat_model

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _to_lc_messages(raw: list[dict[str, Any]]) -> list[Any]:
    out: list[Any] = []
    for m in raw:
        role = str(m.get("role", "")).strip().lower()
        content = str(m.get("content", ""))
        if role in ("user", "human"):
            out.append(HumanMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        elif role == "system":
            out.append(SystemMessage(content=content))
    return out


def should_continue_tools(state: DeskAgentState) -> Literal["tools", "finalize"]:
    iteration = int(state.get("iteration") or 0)
    max_it = int(state.get("max_iterations") or 8)
    if iteration >= max_it:
        return "finalize"
    msgs = state.get("messages") or []
    if not msgs:
        return "finalize"
    last = msgs[-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"
    return "finalize"


def route_after_tools(state: DeskAgentState) -> Literal["agent", "finalize"]:
    iteration = int(state.get("iteration") or 0)
    max_it = int(state.get("max_iterations") or 8)
    if iteration >= max_it:
        return "finalize"
    return "agent"


def make_load_context_node(settings: Settings):
    async def load_context(state: DeskAgentState) -> dict[str, Any]:
        raw = state.get("_raw_messages") or []
        capped = tail_messages(raw if isinstance(raw, list) else [], 20)
        lc = _to_lc_messages(capped)
        wp = str(state.get("workspace_path") or "").strip()
        trace = truncate_trace(list(state.get("trace") or []) + ["load_context"])
        sys = _load_prompt("desk_agent_system")
        mem_block = format_agent_memory_block(truncate_memory_for_desk(state.get("agent_memory")))
        if mem_block:
            sys += f"\n\n{mem_block}"
        if wp:
            sys += f"\n\n## Workspace\nCaminho absoluto: `{wp}`"
        smtp_block = format_smtp_block_for_prompt(state.get("smtp_context"))
        if smtp_block:
            sys += smtp_block
        return {
            "messages": [SystemMessage(content=sys), *lc],
            "trace": trace,
            "iteration": 0,
        }

    return load_context


def make_agent_node(settings: Settings):
    tools = desk_langchain_tools()

    async def agent(state: DeskAgentState) -> dict[str, Any]:
        # O provider já vem resolvido em run_desk_reply (perfil/chave ou Ollama).
        # Usar effective_provider (não desk_effective_provider) para não voltar a
        # bloquear cloud quando o utilizador escolheu um perfil com chave.
        mp = effective_provider(str(state.get("model_provider") or ""))
        chat = get_chat_model(settings, mp)
        bound = chat.bind_tools(tools)
        msgs = list(state.get("messages") or [])
        resp = await bound.ainvoke(msgs)
        iteration = int(state.get("iteration") or 0) + 1
        trace = truncate_trace(list(state.get("trace") or []) + ["agent"])
        pending: list[dict[str, Any]] = []
        if isinstance(resp, AIMessage) and resp.tool_calls:
            for tc in resp.tool_calls:
                pending.append(
                    {
                        "id": tc.get("id") or str(uuid.uuid4()),
                        "name": tc.get("name", ""),
                        "args": tc.get("args") or {},
                    },
                )
        return {
            "messages": [resp],
            "iteration": iteration,
            "trace": trace,
            "pending_tool_calls": pending,
        }

    return agent


def make_tools_node(
    settings: Settings,
    *,
    bridge_wait,
    emit=None,
    use_local: bool = False,
):
    async def tools(state: DeskAgentState) -> dict[str, Any]:
        pending = list(state.get("pending_tool_calls") or [])
        wp = str(state.get("workspace_path") or "")
        cid = str(state.get("desk_context", {}).get("conversation_id") or "")

        async def _emit(kind: str, payload: dict[str, Any]) -> None:
            if emit:
                r = emit(kind, payload)
                if hasattr(r, "__await__"):
                    await r

        tool_results = await dispatch_tool_calls(
            settings,
            tool_calls=pending,
            workspace_path=wp,
            conversation_id=cid,
            bridge_wait=bridge_wait,
            emit=_emit,
            use_local=use_local,
        )
        tool_msgs = [
            ToolMessage(content=tr["content"], tool_call_id=tr["tool_call_id"], name=tr["name"])
            for tr in tool_results
        ]
        trace = truncate_trace(list(state.get("trace") or []) + ["tools"])
        return {
            "messages": tool_msgs,
            "trace": trace,
            "pending_tool_calls": [],
        }

    return tools


async def finalize(state: DeskAgentState) -> dict[str, Any]:
    msgs = state.get("messages") or []
    text = ""
    for m in reversed(msgs):
        if isinstance(m, AIMessage):
            raw = m.content
            if isinstance(raw, str):
                text = raw.strip()
            elif isinstance(raw, list):
                parts = [
                    p.get("text", "")
                    for p in raw
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                text = "".join(parts).strip()
            if text:
                break
    if not text and msgs:
        last = msgs[-1]
        if hasattr(last, "content"):
            text = str(last.content).strip()
    meta = {
        "intent": "desk_agent",
        "routed_intent": "desk_agent",
        "model_provider": str(state.get("model_provider") or "ollama"),
        "trace": list(state.get("trace") or []) + ["finalize"],
    }
    return {
        "assistant_text": text or "Concluído.",
        "metadata": meta,
        "trace": truncate_trace(list(state.get("trace") or []) + ["finalize"]),
    }


def build_desk_graph(
    settings: Settings,
    *,
    bridge_wait,
    emit=None,
    use_local: bool = False,
):
    g = StateGraph(DeskAgentState)
    g.add_node("load_context", make_load_context_node(settings))
    g.add_node("agent", make_agent_node(settings))
    g.add_node(
        "tools",
        make_tools_node(settings, bridge_wait=bridge_wait, emit=emit, use_local=use_local),
    )
    g.add_node("finalize", finalize)
    g.add_edge(START, "load_context")
    g.add_edge("load_context", "agent")
    g.add_conditional_edges(
        "agent", should_continue_tools, {"tools": "tools", "finalize": "finalize"}
    )
    g.add_conditional_edges("tools", route_after_tools, {"agent": "agent", "finalize": "finalize"})
    g.add_edge("finalize", END)
    return g.compile()


def get_compiled_desk_graph(settings: Settings):
    """Grafo compilado sem bridge (só compilação — testes)."""

    async def _noop_wait(_cid: str, _id: str, _payload: dict, _t: float) -> dict[str, Any]:
        return {"ok": False, "error": "no_bridge"}

    return build_desk_graph(settings, bridge_wait=_noop_wait, use_local=True)
