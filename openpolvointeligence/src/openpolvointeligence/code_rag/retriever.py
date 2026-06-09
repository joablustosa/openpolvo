"""Recuperação semântica — Router traz só ficheiros relevantes ao contexto."""

from __future__ import annotations

from typing import Any, Sequence

from openpolvointeligence.code_rag.embedder import embed_query
from openpolvointeligence.code_rag.types import ChunkType, LayerHint, RetrievedChunk
from openpolvointeligence.code_rag.vector_store import get_vector_store
from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow_router_logic import infer_affected_layers

# Sinais de feature → boost de tipos de chunk e termos de query
_FEATURE_SIGNALS: dict[str, dict[str, Any]] = {
    "auth": {
        "terms": (
            "autenticação autenticacao auth login logout session jwt oauth nextauth supabase auth "
            "middleware protected route guard signup register"
        ),
        "chunk_types": ("config", "route", "hook", "function"),
        "path_hints": (
            "middleware",
            "auth",
            "nextauth",
            "supabase",
            "session",
            "login",
            "api/auth",
        ),
    },
    "payment": {
        "terms": "pagamento payment stripe checkout billing subscription webhook",
        "chunk_types": ("config", "route", "function"),
        "path_hints": ("stripe", "payment", "checkout", "billing", "webhook"),
    },
    "database": {
        "terms": "banco database prisma supabase postgres migration schema sql",
        "chunk_types": ("config", "module", "function"),
        "path_hints": ("prisma", "schema", "migration", "db", "database"),
    },
    "api": {
        "terms": "api endpoint rota route handler controller rest graphql",
        "chunk_types": ("route", "function", "config"),
        "path_hints": ("api/", "routes", "handlers", "internal/"),
    },
    "ui": {
        "terms": "componente página pagina button modal form layout ui ux css tailwind",
        "chunk_types": ("component", "hook", "module"),
        "path_hints": ("components/", "pages/", "app/", "src/"),
    },
}


def detect_feature_domains(user_prompt: str) -> list[str]:
    p = (user_prompt or "").lower()
    hits: list[str] = []
    for domain, spec in _FEATURE_SIGNALS.items():
        if any(t in p for t in spec["terms"].split()):
            hits.append(domain)
    return hits or ["api"]


def expand_rag_query(user_prompt: str) -> str:
    """Enriquece query com termos de domínio (melhora recall sem LLM extra)."""
    domains = detect_feature_domains(user_prompt)
    extra: list[str] = []
    for d in domains:
        spec = _FEATURE_SIGNALS[d]
        extra.extend(spec["terms"].split()[:12])
        extra.extend(spec.get("path_hints", ()))
    return f"{user_prompt}\n\ncontext: {' '.join(dict.fromkeys(extra))}"


def _chunk_types_for_prompt(user_prompt: str, layer: LayerHint | None) -> tuple[ChunkType, ...]:
    domains = detect_feature_domains(user_prompt)
    types: set[ChunkType] = {"config", "route"}
    for d in domains:
        for t in _FEATURE_SIGNALS[d].get("chunk_types", ()):
            types.add(t)  # type: ignore[arg-type]
    if layer == "frontend":
        types.update({"component", "hook", "module"})
    elif layer == "backend":
        types.update({"function", "route", "module"})
    else:
        types.update({"component", "function", "hook"})
    return tuple(types)


def _layers_for_prompt(user_prompt: str) -> tuple[LayerHint, ...] | None:
    layer = infer_affected_layers(user_prompt)
    if layer == "fullstack":
        return None
    return (layer, "shared")  # type: ignore[return-value]


def dedupe_paths(chunks: Sequence[RetrievedChunk]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for c in chunks:
        if c.path not in seen:
            seen.add(c.path)
            out.append(c.path)
    return out


async def retrieve_for_router(
    settings: Settings,
    project_id: str,
    user_prompt: str,
    *,
    top_k: int | None = None,
    use_mock: bool = False,
) -> tuple[list[RetrievedChunk], list[str]]:
    """
      Busca semântica orientada ao Router.

      Prioriza config + rotas; devolve paths únicos para injectar no contexto
    (ignorando o resto do app).
    """
    if not project_id or not (user_prompt or "").strip():
        return [], []

    k = top_k or int(getattr(settings, "code_rag_router_top_k", 8) or 8)
    layer = infer_affected_layers(user_prompt)
    chunk_types = _chunk_types_for_prompt(user_prompt, layer if layer != "fullstack" else None)
    layers = _layers_for_prompt(user_prompt)

    query = expand_rag_query(user_prompt)
    q_emb = await embed_query(settings, query, use_mock=use_mock)

    dsn = (getattr(settings, "code_rag_database_url", None) or "").strip() or None
    store = get_vector_store(dsn)

    # Pass 1: config + routes only (estreito — não estourar tokens)
    narrow_types: tuple[ChunkType, ...] = ("config", "route")
    config_hits = await store.search(
        project_id,
        q_emb,
        top_k=max(4, k // 2),
        chunk_types=narrow_types,
        layers=layers,
    )

    # Pass 2: componentes/funções do domínio
    other_types = tuple(t for t in chunk_types if t not in narrow_types)
    other_hits: list[RetrievedChunk] = []
    if other_types:
        other_hits = await store.search(
            project_id,
            q_emb,
            top_k=k,
            chunk_types=other_types,
            layers=layers,
        )

    merged: list[RetrievedChunk] = []
    seen_keys: set[str] = set()
    for chunk in config_hits + other_hits:
        key = f"{chunk.path}:{chunk.symbol_name or ''}:{chunk.start_line}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        merged.append(chunk)

    merged.sort(key=lambda c: c.score, reverse=True)
    merged = merged[:k]
    paths = dedupe_paths(merged)
    return merged, paths


def build_rag_context_block(chunks: Sequence[RetrievedChunk], max_chars: int = 4500) -> str:
    """Formata bloco compacto para o Router / Architect (só trechos relevantes)."""
    if not chunks:
        return ""

    lines = ["## Code RAG — ficheiros relevantes (busca semântica)", ""]
    used = 0
    for c in chunks:
        sym = f" `{c.symbol_name}`" if c.symbol_name else ""
        header = (
            f"### {c.path}{sym} ({c.chunk_type}, score={c.score:.2f}, L{c.start_line}-{c.end_line})"
        )
        block = f"{header}\n```\n{c.excerpt[:900]}\n```\n"
        if used + len(block) > max_chars:
            break
        lines.append(block)
        used += len(block)

    paths = dedupe_paths(chunks)
    lines.append(f"\n**Paths sugeridos ({len(paths)}):** {', '.join(paths[:12])}")
    if len(paths) > 12:
        lines.append(f"… +{len(paths) - 12} ficheiros")
    return "\n".join(lines)


def filter_manifest_to_rag_paths(
    all_paths: Sequence[str],
    rag_paths: Sequence[str],
    *,
    always_include: Sequence[str] = ("package.json", "go.mod"),
) -> tuple[list[str], int]:
    """Reduz manifesto à união RAG + ficheiros estruturais mínimos."""
    rag_set = set(rag_paths)
    for p in always_include:
        for ap in all_paths:
            if ap.endswith(p) or ap == p:
                rag_set.add(ap)
    filtered = [p for p in all_paths if p in rag_set]
    skipped = len(all_paths) - len(filtered)
    return filtered, skipped
