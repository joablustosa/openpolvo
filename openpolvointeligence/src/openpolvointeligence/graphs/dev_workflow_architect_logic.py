"""Architect — plano de execução JSON a partir do Mapa de Contexto Compacto."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow_router_logic import AffectedLayer
from openpolvointeligence.graphs.dev_workflow_state import StackId

_FRONTEND_PATH_MARKERS = (
    "src/",
    "pages/",
    "page/",
    "components/",
    "app/",
    "views/",
    "ui/",
    ".tsx",
    ".jsx",
    ".vue",
    ".css",
    ".scss",
    ".html",
)

_BACKEND_PATH_MARKERS = (
    "cmd/",
    "internal/",
    "pkg/",
    "api/",
    "handlers/",
    "handler/",
    "routes/",
    "router/",
    "controllers/",
    "server/",
    "middleware/",
    ".go",
    "main.go",
)


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def _path_layer(path: str) -> str:
    pl = _norm_path(path).lower()
    is_fe = any(m in pl for m in _FRONTEND_PATH_MARKERS)
    is_be = any(m in pl for m in _BACKEND_PATH_MARKERS)
    if is_fe and is_be:
        return "ambiguous"
    if is_be:
        return "backend"
    if is_fe:
        return "frontend"
    if pl.endswith((".ts", ".js")) and "api" in pl:
        return "backend"
    return "unknown"


def filter_paths_by_layer(paths: list[str], layer: AffectedLayer) -> list[str]:
    if layer == "fullstack":
        return paths
    keep: list[str] = []
    for raw in paths:
        p = _norm_path(raw)
        if not p or ".." in p:
            continue
        pl = _path_layer(p)
        if layer == "frontend" and pl in ("frontend", "unknown", "ambiguous"):
            keep.append(p)
        elif layer == "backend" and pl in ("backend", "unknown", "ambiguous"):
            keep.append(p)
    return keep


def _dedupe_paths(paths: list[str], limit: int = 20) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in paths:
        p = _norm_path(raw)
        if not p or p in seen or ".." in p:
            continue
        seen.add(p)
        out.append(p)
        if len(out) >= limit:
            break
    return out


def paths_from_compact_map(compact: dict[str, Any]) -> list[str]:
    """Extrai paths conhecidos do mapa compacto."""
    found: list[str] = []
    for mod in compact.get("module_signatures") or []:
        if isinstance(mod, dict) and mod.get("file"):
            found.append(str(mod["file"]))
    for contract in compact.get("api_contracts") or []:
        if isinstance(contract, dict) and contract.get("handler_file"):
            found.append(str(contract["handler_file"]))
    return _dedupe_paths(found, 40)


def match_paths_for_feature(
    user_prompt: str,
    manifest_paths: list[str],
    compact: dict[str, Any],
) -> dict[str, list[str]]:
    """Associa paths existentes a palavras-chave do pedido (ex.: contratos)."""
    prompt = (user_prompt or "").lower()
    keywords: list[str] = []
    if "contrato" in prompt or "contract" in prompt:
        keywords.extend(["contrato", "contract", "contracts"])
    if "pdf" in prompt:
        keywords.append("pdf")
    if "export" in prompt or "exportar" in prompt:
        keywords.extend(["export", "exportar"])
    if any(
        k in prompt
        for k in (
            "corrige",
            "corrigir",
            "fix",
            "altera",
            "muda",
            "modifica",
            "landing",
            "hero",
            "footer",
            "navbar",
            "página",
            "pagina",
            "site",
            "preview",
            "componente",
        )
    ):
        keywords.extend(
            [
                "landing",
                "page",
                "hero",
                "footer",
                "navbar",
                "app",
                "index",
                "main",
                "home",
            ],
        )

    all_paths = _dedupe_paths(
        list(manifest_paths) + paths_from_compact_map(compact),
        200,
    )
    matched: list[str] = []
    for p in all_paths:
        pl = p.lower()
        if any(k in pl for k in keywords):
            matched.append(p)
    return {"matched_existing": matched, "all_manifest": all_paths}


def _prune_to_rag_scope(paths: list[str], rag_paths: list[str] | None) -> list[str]:
    """Mantém só paths do Code RAG (+ package.json / go.mod)."""
    if not rag_paths:
        return paths
    allowed = set(rag_paths)
    for p in rag_paths:
        allowed.add(p)
    out: list[str] = []
    for p in paths:
        if p in allowed:
            out.append(p)
            continue
        if p.endswith(("package.json", "go.mod", ".env.example")):
            out.append(p)
    return out


_PALETTE_BASES = frozenset({"zinc", "slate", "neutral"})
_BORDER_RADIUS = frozenset({"sm", "md", "lg"})
_LAYOUT_SHELLS = frozenset({"marketing", "dashboard"})
_ACCENTS = frozenset(
    {
        "blue",
        "violet",
        "emerald",
        "orange",
        "rose",
        "cyan",
    }
)
_MODES = frozenset({"light", "dark"})


def normalize_design_tokens(raw: Any) -> dict[str, str]:
    """Normaliza design_tokens do Architect para downstream (Code_Generator)."""
    if not isinstance(raw, dict):
        raw = {}
    palette = str(raw.get("palette_base") or "zinc").lower().strip()
    if palette not in _PALETTE_BASES:
        palette = "zinc"
    radius = str(raw.get("border_radius") or "md").lower().strip()
    if radius not in _BORDER_RADIUS:
        radius = "md"
    accent = str(raw.get("accent") or "blue").lower().strip()
    if accent not in _ACCENTS:
        accent = "blue"
    mode = str(raw.get("mode") or "light").lower().strip()
    if mode not in _MODES:
        mode = "light"
    shell = str(raw.get("layout_shell") or "marketing").lower().strip()
    if shell not in _LAYOUT_SHELLS:
        shell = "marketing"
    return {
        "palette_base": palette,
        "border_radius": radius,
        "accent": accent,
        "mode": mode,
        "layout_shell": shell,
    }


def normalize_architect_plan(
    data: dict[str, Any],
    *,
    affected_layers: AffectedLayer,
    stack_hint: StackId | None,
    user_prompt: str,
    manifest_paths: list[str],
    compact_context_map: dict[str, Any],
    rag_relevant_paths: list[str] | None = None,
) -> dict[str, Any]:
    """Converte resposta LLM em plano estruturado; filtra ficheiros irrelevantes."""
    exec_raw = data.get("execution_plan")
    if not isinstance(exec_raw, dict):
        exec_raw = {}

    create_raw = data.get("files_to_create") or exec_raw.get("files_to_create") or []
    modify_raw = data.get("files_to_modify") or exec_raw.get("files_to_modify") or []
    legacy_targets = data.get("targets") or []

    files_to_create = _dedupe_paths(
        [str(p) for p in create_raw if p],
        15,
    )
    files_to_modify = _dedupe_paths(
        [str(p) for p in modify_raw if p] + [str(p) for p in legacy_targets if p],
        15,
    )
    modify_before_step_filter = list(files_to_modify)

    # Enriquecer com paths do mapa compacto quando pedido menciona entidade existente
    feature_paths = match_paths_for_feature(
        user_prompt,
        manifest_paths,
        compact_context_map,
    )
    for p in feature_paths["matched_existing"]:
        if p not in files_to_modify and p not in files_to_create:
            files_to_modify.append(p)
    files_to_modify = _dedupe_paths(files_to_modify, 15)

    # Filtrar por camada decidida pelo Router
    files_to_create = filter_paths_by_layer(files_to_create, affected_layers)
    files_to_modify = filter_paths_by_layer(files_to_modify, affected_layers)

    # Code RAG — não planear ficheiros fora do scope recuperado
    files_to_create = _prune_to_rag_scope(files_to_create, rag_relevant_paths)
    files_to_modify = _prune_to_rag_scope(files_to_modify, rag_relevant_paths)

    # targets = união exacta para nós downstream (Code_Generator só vê isto)
    targets = _dedupe_paths(files_to_create + files_to_modify, 20)
    mkdirs = _dedupe_paths([str(p) for p in (data.get("mkdirs") or []) if p], 10)

    steps_raw = exec_raw.get("steps") or data.get("steps") or []
    steps: list[dict[str, Any]] = []
    step_files: set[str] = set()
    if isinstance(steps_raw, list):
        for i, row in enumerate(steps_raw[:8]):
            if not isinstance(row, dict):
                continue
            step_file_list = _dedupe_paths(
                [str(f) for f in (row.get("files") or []) if f],
                8,
            )
            step_files.update(step_file_list)
            steps.append(
                {
                    "order": int(row.get("order") or i + 1),
                    "layer": str(row.get("layer") or "")[:20],
                    "action": str(row.get("action") or "")[:40],
                    "description": str(row.get("description") or "")[:200],
                    "files": step_file_list,
                },
            )

    backend_routes: list[dict[str, Any]] = []
    route_files: set[str] = set()
    for row in data.get("backend_routes") or exec_raw.get("backend_routes") or []:
        if isinstance(row, dict) and row.get("path"):
            rf = str(row.get("file") or "")[:120]
            if rf:
                route_files.add(_norm_path(rf))
            backend_routes.append(
                {
                    "method": str(row.get("method") or "GET").upper()[:10],
                    "path": str(row.get("path"))[:120],
                    "handler": str(row.get("handler") or "")[:80],
                    "file": rf,
                },
            )

    # Remover ficheiros irrelevantes: só paths citados nos steps, rotas ou match semântico
    if steps:
        keyword_matched = set(feature_paths["matched_existing"])
        allowed = step_files | route_files | keyword_matched
        files_to_modify = [p for p in files_to_modify if p in allowed]
        files_to_create = [p for p in files_to_create if p in allowed or p not in manifest_paths]
        if not files_to_modify and modify_before_step_filter:
            files_to_modify = _prune_to_rag_scope(
                modify_before_step_filter,
                rag_relevant_paths,
            )

    stack = str(data.get("stack") or exec_raw.get("scope") or stack_hint or "vite-react")
    if stack not in (
        "next-react",
        "angular",
        "vite-react",
        "go-api",
        "node-api",
        "fullstack-mixed",
    ):
        stack = stack_hint or "fullstack-mixed"

    scope = str(exec_raw.get("scope") or data.get("scope") or affected_layers)

    design_tokens: dict[str, str] = {}
    if scope in ("frontend", "fullstack"):
        design_tokens = normalize_design_tokens(data.get("design_tokens"))

    out: dict[str, Any] = {
        "stack": stack,
        "scope": scope,
        "feature": str(exec_raw.get("feature") or data.get("feature") or "")[:200],
        "execution_plan": {
            "scope": scope,
            "feature": str(exec_raw.get("feature") or "")[:200],
            "steps": steps,
        },
        "files_to_create": files_to_create,
        "files_to_modify": files_to_modify,
        "targets": targets,
        "mkdirs": mkdirs,
        "rationale": str(data.get("rationale") or "")[:500],
        "npm_packages": [str(p) for p in (data.get("npm_packages") or []) if p][:15],
        "go_modules": [str(p) for p in (data.get("go_modules") or []) if p][:15],
        "backend_routes": backend_routes[:10],
        "frontend_changes": [
            {
                "file": str(r.get("file") or "")[:120],
                "change": str(r.get("change") or "")[:200],
            }
            for r in (data.get("frontend_changes") or [])
            if isinstance(r, dict) and r.get("file")
        ][:10],
        "excluded_note": str(data.get("excluded_note") or "")[:300],
    }
    if design_tokens:
        out["design_tokens"] = design_tokens
    return out


def build_architect_human_suffix(state: dict[str, Any]) -> str:
    layer = state.get("affected_layers") or "fullstack"
    compact = state.get("compact_context_map") or {}
    manifest = [
        str(r.get("path", "")) for r in (state.get("file_manifest") or []) if isinstance(r, dict)
    ]
    feature = match_paths_for_feature(
        str(state.get("user_prompt") or ""),
        manifest,
        compact,
    )
    rag_paths = state.get("rag_relevant_paths") or []
    rag_note = ""
    if rag_paths:
        rag_note = (
            f"\n\n## Code RAG — scope obrigatório\n"
            f"Altera **somente** estes paths (recuperados semanticamente):\n"
            f"{', '.join(rag_paths[:20])}\n"
            f"Não modifiques outros ficheiros do app neste turno."
        )
    return (
        f"\n\n## Router decidiu\n"
        f"- Camadas: **{layer}**\n"
        f"- Stack hint: {state.get('stack_hint') or 'auto'}\n"
        f"- Resumo: {state.get('feature_summary') or state.get('route_reason') or ''}\n\n"
        f"## Paths existentes relevantes ao pedido\n"
        f"{feature['matched_existing'] or '(nenhum — pode ser feature nova)'}\n\n"
        f"## Regra\n"
        f"Lista **apenas** ficheiros em `files_to_create` / `files_to_modify` necessários "
        f"para esta feature. Não incluas ficheiros fora do scope `{layer}`."
        f"{rag_note}"
    )
