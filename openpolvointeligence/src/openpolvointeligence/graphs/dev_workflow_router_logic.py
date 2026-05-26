"""Router — classificação de camada (Frontend / Backend / Fullstack) e rota."""

from __future__ import annotations

import re
from typing import Any, Literal

from openpolvointeligence.graphs.dev_workflow_state import RouteDecision, StackId

AffectedLayer = Literal["frontend", "backend", "fullstack"]

_FRONTEND_SIGNALS = (
    "botão",
    "botao",
    "button",
    "tela",
    "página",
    "pagina",
    "page",
    "componente",
    "component",
    "ui ",
    " ux",
    "frontend",
    "front-end",
    "react",
    "angular",
    "vite",
    "next",
    "css",
    "modal",
    "formulário",
    "formulario",
    "layout",
    "sidebar",
    "navbar",
    "ícone",
    "icone",
    "estilo",
    "visual",
    "landing",
    "dashboard",
    "contratos",
    "contracts",
)

_BACKEND_SIGNALS = (
    "rota",
    "route",
    "endpoint",
    "api ",
    "/api",
    "backend",
    "back-end",
    "servidor",
    "server",
    "handler",
    "controller",
    "middleware",
    " banco",
    "database",
    "sql",
    "migration",
    " go ",
    "gin.",
    "echo.",
    "fiber.",
    "express",
    "fastify",
    "node api",
    "gerar arquivo",
    "gerar ficheiro",
    "generate pdf",
    "export pdf",
    "pdf no backend",
    "microservi",
)


def infer_affected_layers(user_prompt: str) -> AffectedLayer:
    """Heurística zero-token: Frontend, Backend ou ambos."""
    p = (user_prompt or "").lower()
    fe = any(k in p for k in _FRONTEND_SIGNALS)
    be = any(k in p for k in _BACKEND_SIGNALS)
    # UI + rota/backend explícitos
    if re.search(r"\brota\b.*\b(backend|api|servidor)\b", p) or re.search(
        r"\b(backend|api)\b.*\brota\b",
        p,
    ):
        be = True
    if re.search(r"\b(tela|página|pagina|botão|botao|button|componente)\b", p):
        fe = True
    if fe and be:
        return "fullstack"
    if be:
        return "backend"
    if fe:
        return "frontend"
    return "fullstack"


def normalize_affected_layers(raw: str | None, fallback_prompt: str = "") -> AffectedLayer:
    if not raw:
        return infer_affected_layers(fallback_prompt)
    s = raw.strip().lower().replace("_", "-")
    if s in ("frontend", "front-end", "fe", "ui"):
        return "frontend"
    if s in ("backend", "back-end", "be", "api"):
        return "backend"
    if s in ("fullstack", "both", "frontend-backend", "frontend+backend", "full-stack"):
        return "fullstack"
    return infer_affected_layers(fallback_prompt)


def normalize_route(raw: str) -> RouteDecision:
    r = (raw or "architect").strip().lower()
    if r in ("architect", "patch", "explain", "abort"):
        return r  # type: ignore[return-value]
    return "architect"


def normalize_stack(raw: str | None) -> StackId | None:
    if not raw:
        return None
    s = raw.strip().lower()
    allowed: tuple[StackId, ...] = (
        "next-react",
        "angular",
        "vite-react",
        "go-api",
        "node-api",
        "fullstack-mixed",
    )
    return s if s in allowed else None  # type: ignore[return-value]


def stack_hint_from_layers(layer: AffectedLayer, compact_stack: str | None = None) -> StackId:
    if compact_stack:
        norm = normalize_stack(compact_stack)
        if norm:
            return norm
    if layer == "backend":
        return "go-api"
    if layer == "frontend":
        return "vite-react"
    return "fullstack-mixed"


def parse_router_response(
    data: dict[str, Any],
    *,
    user_prompt: str,
) -> dict[str, Any]:
    """Normaliza JSON do LLM Router."""
    route = normalize_route(str(data.get("route", "architect")))
    layer = normalize_affected_layers(
        str(data.get("affected_layers") or data.get("layer") or ""),
        user_prompt,
    )
    stack = normalize_stack(str(data.get("stack_hint"))) or stack_hint_from_layers(layer)
    conf = float(data.get("confidence") or 0.75)
    conf = max(0.0, min(1.0, conf))
    return {
        "route": route,
        "affected_layers": layer,
        "stack_hint": stack,
        "route_confidence": conf,
        "route_reason": str(data.get("reason") or data.get("feature_summary") or "")[:400],
        "feature_summary": str(data.get("feature_summary") or "")[:300],
    }


def build_router_human_suffix(state: dict[str, Any]) -> str:
    """Dica heurística injectada no human message (barata, sem LLM extra)."""
    prompt = str(state.get("user_prompt") or "")
    hint = infer_affected_layers(prompt)
    parts = [
        f"\n\n## Pré-análise heurística (referência)\n"
        f"- Camadas prováveis: **{hint}**\n"
        f"- Pedido: {prompt[:500]}",
    ]
    rag_paths = state.get("rag_relevant_paths") or []
    if rag_paths:
        skipped = int(state.get("rag_skipped_paths") or 0)
        parts.append(
            f"\n\n## Code RAG (só estes paths entram no plano)\n"
            f"- Ficheiros recuperados: {', '.join(rag_paths[:15])}\n"
            f"- Resto do app ignorado neste turno: ~{skipped} paths",
        )
    return "".join(parts)
