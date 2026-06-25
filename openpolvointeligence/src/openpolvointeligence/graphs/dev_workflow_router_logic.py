"""Router — classificação de camada (Frontend / Backend / Fullstack) e rota."""

from __future__ import annotations

import re
from typing import Any, Literal, Sequence

from openpolvointeligence.graphs.dev_workflow_request_kind import (
    classify_request_kind,
    route_for_request_kind,
)
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


_CODE_CHANGE_KEYWORDS = (
    "corrige",
    "corrigir",
    "correção",
    "correcção",
    "correcao",
    "fix",
    "conserta",
    "consertar",
    "altera",
    "alterar",
    "muda",
    "mudar",
    "modifica",
    "modificar",
    "atualiza",
    "atualizar",
    "adiciona",
    "adicionar",
    "remove",
    "remover",
    "implementa",
    "implementar",
    "aplica",
    "ajusta",
    "ajustar",
    "refatora",
    "melhora",
    "melhorar",
    "no código",
    "no codigo",
    "no preview",
    "no site",
    "na página",
    "na pagina",
    "erro",
    "bug",
    "não funciona",
    "nao funciona",
    "está errado",
    "esta errado",
    "falta",
    "cria o",
    "criar o",
    "gera o",
    "gerar o",
)

_EXPLAIN_ONLY_KEYWORDS = (
    "o que é",
    "o que e ",
    "como funciona",
    "explica-me",
    "explica me",
    "explica o",
    "porque é",
    "por que é",
    "qual a diferença",
    "sem alterar",
    "não alteres",
    "nao alteres",
    "não mudes",
    "nao mudes",
)


def infer_force_code_route(
    user_prompt: str,
    *,
    has_project: bool,
) -> RouteDecision | None:
    """
    Pedidos de correcção/alteração com projecto activo devem gerar código, não só chat.
    """
    if not has_project:
        return None
    p = (user_prompt or "").lower()
    wants_code = any(k in p for k in _CODE_CHANGE_KEYWORDS)
    if not wants_code:
        return None
    if any(e in p for e in _EXPLAIN_ONLY_KEYWORDS) and not any(
        k in p for k in ("corrige", "corrigir", "fix", "altera", "modifica", "implementa")
    ):
        return None
    patch_hints = (
        "só ",
        "so ",
        "apenas ",
        "pontual",
        "rápid",
        "rapid",
        "cor ",
        "cor do",
        "texto",
        "botão",
        "botao",
        "titulo",
        "título",
        "label",
        "import ",
        "linha ",
    )
    if any(h in p for h in patch_hints):
        return "patch"
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
        return "node-api"
    if layer == "frontend":
        return "vite-react"
    return "fullstack-mixed"


_FRONT_ONLY_HINTS = (
    "apenas frontend",
    "somente frontend",
    "só frontend",
    "so frontend",
    "frontend only",
    "sem backend",
)

_BACK_ONLY_HINTS = (
    "apenas backend",
    "somente backend",
    "só backend",
    "so backend",
    "backend only",
    "sem frontend",
)

_STACK_NODE_HINTS = (
    "node",
    "node.js",
    "nodejs",
    "express",
    "fastify",
    "nest",
    "hono",
)

_STACK_GO_HINTS = ("golang", "go api", "api go", "backend go", "chi", "gin", "fiber")
_STACK_ANGULAR_HINTS = ("angular",)
_STACK_NEXT_HINTS = ("next", "next.js", "nextjs")
_STACK_REACT_HINTS = ("react", "vite")


def _stack_hint_from_user_prompt(user_prompt: str) -> StackId | None:
    """Detecta stack explicitamente pedida pelo utilizador."""
    p = (user_prompt or "").lower()
    if any(k in p for k in _STACK_GO_HINTS):
        return "go-api"
    if any(k in p for k in _STACK_ANGULAR_HINTS):
        return "angular"
    if any(k in p for k in _STACK_NEXT_HINTS):
        return "next-react"
    if any(k in p for k in _STACK_NODE_HINTS):
        if any(k in p for k in _STACK_REACT_HINTS):
            return "fullstack-mixed"
        return "node-api"
    if any(k in p for k in _STACK_REACT_HINTS):
        if any(k in p for k in _FRONT_ONLY_HINTS):
            return "vite-react"
        return "fullstack-mixed"
    return None


def _stack_hint_from_references(
    compact_stack: str | None,
    manifest_paths: Sequence[str] | None,
) -> StackId | None:
    """Infere stack a partir do contexto do projecto (paths e mapa compacto)."""
    norm_compact = normalize_stack(compact_stack)
    if norm_compact:
        return norm_compact
    if not manifest_paths:
        return None
    paths = [str(p).strip().replace("\\", "/").lower() for p in manifest_paths if p]
    has_go = any(p.endswith(".go") or p.endswith("go.mod") for p in paths)
    has_server = any(p.startswith("server/") for p in paths)
    has_src = any(p.startswith("src/") for p in paths)
    has_angular = any(p.endswith("angular.json") for p in paths)
    has_next = any("/app/" in p or p.endswith("next.config.js") for p in paths)
    if has_angular:
        return "angular"
    if has_next:
        return "next-react"
    if has_go and has_src:
        return "fullstack-mixed"
    if has_go:
        return "go-api"
    if has_server and has_src:
        return "fullstack-mixed"
    if has_server:
        return "node-api"
    if has_src:
        return "vite-react"
    return None


def _should_force_default_fullstack(
    *,
    user_prompt: str,
    has_project: bool,
    request_kind: str,
    explicit_stack: StackId | None,
    referenced_stack: StackId | None,
) -> bool:
    """Sem stack/referência explícita, default do estúdio = React + Node fullstack."""
    if has_project:
        return False
    if request_kind != "new_app":
        return False
    if explicit_stack or referenced_stack:
        return False
    p = (user_prompt or "").lower()
    if any(k in p for k in _FRONT_ONLY_HINTS) or any(k in p for k in _BACK_ONLY_HINTS):
        return False
    return True


def parse_router_response(
    data: dict[str, Any],
    *,
    user_prompt: str,
    has_project: bool = False,
    has_build_errors: bool = False,
    compact_stack: str | None = None,
    manifest_paths: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Normaliza JSON do LLM Router e classifica o tipo de pedido."""
    # Classificação explícita: determinística com prioridade, hint do LLM como apoio.
    request_kind = classify_request_kind(
        user_prompt,
        has_project=has_project,
        has_build_errors=has_build_errors,
        llm_hint=str(data.get("request_kind") or data.get("kind") or "") or None,
    )

    llm_route = normalize_route(str(data.get("route", "architect")))
    # A rota deriva primeiro do tipo de pedido; o LLM só refina dentro do mesmo tipo.
    kind_route = route_for_request_kind(
        request_kind,
        user_prompt=user_prompt,
        has_project=has_project,
    )
    route = normalize_route(kind_route)
    # Permite ao LLM escolher patch quando o tipo deu architect (bug/feature pequena).
    if request_kind in ("feature", "bug_fix") and llm_route == "patch":
        route = "patch"

    forced = infer_force_code_route(user_prompt, has_project=has_project)
    if forced and route in ("explain", "abort"):
        route = forced

    layer = normalize_affected_layers(
        str(data.get("affected_layers") or data.get("layer") or ""),
        user_prompt,
    )
    explicit_stack = _stack_hint_from_user_prompt(user_prompt)
    referenced_stack = _stack_hint_from_references(compact_stack, manifest_paths)
    llm_stack = normalize_stack(str(data.get("stack_hint")))
    default_fullstack = _should_force_default_fullstack(
        user_prompt=user_prompt,
        has_project=has_project,
        request_kind=request_kind,
        explicit_stack=explicit_stack,
        referenced_stack=referenced_stack,
    )
    stack_source = "router_llm"
    if explicit_stack:
        stack = explicit_stack
        stack_source = "user_explicit"
    elif referenced_stack:
        stack = referenced_stack
        stack_source = "project_reference"
    elif llm_stack:
        stack = llm_stack
    elif default_fullstack:
        stack = "fullstack-mixed"
        stack_source = "default_react_node"
    else:
        stack = stack_hint_from_layers(layer, compact_stack)
        stack_source = "layer_fallback"
    if default_fullstack and layer == "frontend":
        layer = "fullstack"
    conf = float(data.get("confidence") or 0.75)
    conf = max(0.0, min(1.0, conf))
    return {
        "route": route,
        "request_kind": request_kind,
        "affected_layers": layer,
        "stack_hint": stack,
        "stack_source": stack_source,
        "stack_defaulted": default_fullstack,
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
