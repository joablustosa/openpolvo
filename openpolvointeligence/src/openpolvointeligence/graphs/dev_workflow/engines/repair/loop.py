"""Auto Repair — unifica corrective e self-heal."""

from __future__ import annotations

from typing import Any

MAX_REPAIR_ATTEMPTS = 3


def should_attempt_repair(state: dict[str, Any]) -> bool:
    if state.get("compile_ok") is True:
        return False
    attempts = int(state.get("corrective_attempts") or state.get("compile_retries") or 0)
    return attempts < MAX_REPAIR_ATTEMPTS


def repair_patch(state: dict[str, Any], reason: str) -> dict[str, Any]:
    attempts = int(state.get("corrective_attempts") or 0) + 1
    return {
        "corrective_attempts": attempts,
        "repair_reason": reason[:500],
        "trace": list(state.get("trace") or []) + [f"repair:attempt:{attempts}"],
    }
