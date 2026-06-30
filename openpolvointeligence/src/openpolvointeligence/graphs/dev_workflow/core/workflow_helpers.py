"""Helpers determinísticos por tipo de workflow (zero-token)."""

from __future__ import annotations

from typing import Any

PLAN_PROMPT_BY_KIND: dict[str, str] = {
    "new_app": "new_app_plan",
    "feature": "feature_plan",
    "bug_fix": "debug_plan",
    "refactor": "refactor_plan",
    "api_design": "api_design_plan",
    "edit": "edit_plan",
    "delete": "delete_plan",
}

_RUNTIME_MARKERS = (
    "undefined",
    "is not defined",
    "cannot read",
    "typeerror",
    "referenceerror",
    "stack trace",
    "traceback",
    "tela branca",
    "página branca",
    "pagina branca",
    "crash",
)

_INTEGRATION_MARKERS = (
    "api",
    "endpoint",
    "cors",
    "401",
    "403",
    "404",
    "500",
    "timeout",
    "fetch",
    "axios",
    "não envia",
    "nao envia",
    "não carrega dados",
    "nao carrega dados",
)


def triage_bug_category(prompt: str) -> str:
    """Classificação determinística: runtime | integration | logic | unknown."""
    low = (prompt or "").lower()
    if any(m in low for m in _RUNTIME_MARKERS):
        return "runtime"
    if any(m in low for m in _INTEGRATION_MARKERS):
        return "integration"
    if any(m in low for m in ("lógica", "logica", "cálculo", "calculo", "regra de negócio")):
        return "logic"
    return "unknown"


def is_valid_openapi_spec(spec: Any) -> bool:
    """Validação mínima OpenAPI 3.x (determinística, sem rede)."""
    if not isinstance(spec, dict):
        return False
    version = str(spec.get("openapi") or spec.get("swagger") or "")
    if not version.startswith("3."):
        return False
    paths = spec.get("paths")
    return isinstance(paths, dict) and len(paths) > 0
