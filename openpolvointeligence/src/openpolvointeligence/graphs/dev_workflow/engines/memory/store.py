"""Memory Engine — compressão e aprendizado por projecto."""

from __future__ import annotations

from typing import Any


def compress_session_summary(state: dict[str, Any], max_chars: int = 1200) -> str:
    """Resumo determinístico sem LLM para histórico comprimido."""
    parts: list[str] = []
    kind = str(state.get("request_kind") or "")
    if kind:
        parts.append(f"kind={kind}")
    steps = state.get("completed_steps") or []
    if steps:
        parts.append(f"steps={','.join(str(s) for s in steps[-8:])}")
    errors = state.get("error_digest") or []
    if errors:
        parts.append(f"errors={len(errors)}")
    text = "; ".join(parts)
    return text[:max_chars]


def merge_project_learning(
    state: dict[str, Any],
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Acumula padrões aprendidos por projecto no estado."""
    learning = dict(state.get("project_learning") or {})
    wf = str(state.get("workflow_id") or "")
    if wf:
        learning["last_workflow"] = wf
    stack_cfg = state.get("stack_config")
    stack = state.get("stack_hint") or (
        stack_cfg.get("stack_id") if isinstance(stack_cfg, dict) else None
    )
    if stack:
        learning["stack"] = str(stack)
    patch["project_learning"] = learning
    patch["session_summary"] = compress_session_summary({**state, **patch})
    return patch
