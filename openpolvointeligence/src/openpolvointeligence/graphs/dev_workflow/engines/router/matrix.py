"""Matriz modelo × nó do grafo."""

from __future__ import annotations

from typing import Literal

ModelTier = Literal["fast", "balanced", "strong"]

# Nós que beneficiam de modelo forte
_STRONG_NODES: frozenset[str] = frozenset(
    {
        "architect",
        "code_generator",
        "legacy_core",
        "requirements",
        "review",
        "planner",
        "workflow_plan",
    }
)

_FAST_NODES: frozenset[str] = frozenset(
    {
        "router",
        "classify",
        "lint_fix",
        "context_loader",
        "stack_selector",
    }
)


def tier_for_node(node_key: str) -> ModelTier:
    key = (node_key or "").strip().lower()
    if key in _STRONG_NODES or key.startswith("step_legacy"):
        return "strong"
    if key in _FAST_NODES:
        return "fast"
    return "balanced"


def resolve_model_for_node(
    base_provider: str | None,
    node_key: str,
) -> str:
    """Resolve provider efectivo; extensível para deepseek/qwen via config futura."""
    tier = tier_for_node(node_key)
    raw = str(base_provider or "auto").strip().lower()
    if raw not in ("", "auto"):
        return raw
    # Por defeito: strong → openai, fast → google se disponível (override via env no caller)
    if tier == "strong":
        return "openai"
    if tier == "fast":
        return "google"
    return "openai"
