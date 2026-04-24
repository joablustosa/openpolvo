from __future__ import annotations

import re
from typing import Any

_MAX_HISTORY = 40
_SUMMARY_LINES = 10
_SUMMARY_LINE_CHARS = 220


_FENCE_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_WS_RE = re.compile(r"\s+")


def _compact_text(s: str) -> str:
    """Reduz ruído para o sumário: remove blocos de código e comprime espaços."""
    if not s:
        return ""
    s = _FENCE_RE.sub(" [código omitido] ", s)
    s = s.replace("\r", " ").replace("\n", " ")
    s = _WS_RE.sub(" ", s).strip()
    return s


def tail_messages(msgs: list[dict[str, Any]], max_n: int = _MAX_HISTORY) -> list[dict[str, Any]]:
    if len(msgs) <= max_n:
        return msgs
    return msgs[-max_n:]


def conversation_summary(msgs: list[dict[str, Any]], last_n: int = _SUMMARY_LINES) -> str:
    slice_ = msgs[-last_n:] if len(msgs) > last_n else msgs
    lines: list[str] = []
    for m in slice_:
        role = str(m.get("role", "")).strip().upper()
        content = _compact_text(str(m.get("content", "")))
        if len(content) > _SUMMARY_LINE_CHARS:
            content = content[:_SUMMARY_LINE_CHARS].rstrip() + "…"
        lines.append(f"[{role}] {content}")
    return "\n".join(lines).strip()


def last_user_text(msgs: list[dict[str, Any]], max_chars: int = 2000) -> str:
    for m in reversed(msgs):
        if str(m.get("role", "")).strip().lower() in ("user", "human"):
            s = str(m.get("content", ""))
            return s[:max_chars] if len(s) > max_chars else s
    return ""
