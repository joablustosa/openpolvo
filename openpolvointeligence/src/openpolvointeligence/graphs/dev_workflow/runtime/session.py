"""Runtime contínuo — sessões e thread_id."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class DevAgentSession:
    thread_id: str
    conversation_id: str
    project_id: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    checkpoint_ns: str = "dev_workflow"


_sessions: dict[str, DevAgentSession] = {}


def resolve_thread_id(
    conversation_id: str | None,
    project_id: str | None = None,
) -> str:
    cid = str(conversation_id or "").strip() or "anonymous"
    pid = str(project_id or "").strip()
    return f"{cid}:{pid}" if pid else cid


def get_or_create_session(
    conversation_id: str,
    *,
    project_id: str = "",
) -> DevAgentSession:
    tid = resolve_thread_id(conversation_id, project_id)
    if tid not in _sessions:
        _sessions[tid] = DevAgentSession(
            thread_id=tid,
            conversation_id=conversation_id,
            project_id=project_id,
        )
    return _sessions[tid]


def session_config(thread_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread_id}}


async def try_resume_merged_state(
    graph: Any,
    config: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any] | None:
    """Funde checkpoint LangGraph com estado da nova mensagem."""
    tid = str((config.get("configurable") or {}).get("thread_id") or "").strip()
    if not tid:
        return None
    try:
        snapshot = await graph.aget_state(config)
    except Exception:
        return None
    if not snapshot or not snapshot.values:
        return None
    prior = dict(snapshot.values)
    # Mensagem nova e contexto fresco sobrepõem checkpoint
    merge_keys = (
        "messages",
        "model_provider",
        "workspace_id",
        "project_files",
        "project_file_tree",
        "file_manifest",
        "project_digest",
        "preview_console_logs",
        "compile_log",
        "dev_studio_context",
        "conversation_id",
        "thread_id",
    )
    for key in merge_keys:
        if key in incoming and incoming[key] is not None:
            prior[key] = incoming[key]
    prior["resumed_from_checkpoint"] = True
    return prior
