"""Budget de tokens para slices de contexto."""

from __future__ import annotations

DEFAULT_SLICE_BUDGETS: dict[str, int] = {
    "global": 800,
    "project": 2000,
    "turn": 1500,
    "agent": 4000,
}


def clip_text(text: str, max_chars: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 3] + "..."
