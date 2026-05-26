"""Estado partilhado do grafo de desenvolvimento (Lovable-style, budget de tokens).

Princípio: o estado global **nunca** transporta o repositório inteiro nem o histórico
completo da conversa. Só referências, digests e deltas do turno actual.
"""

from __future__ import annotations

import hashlib
from typing import Any, Literal, TypedDict

StackId = Literal[
    "next-react",
    "angular",
    "vite-react",
    "go-api",
    "node-api",
    "fullstack-mixed",
]

RouteDecision = Literal[
    "architect",
    "patch",
    "explain",
    "abort",
]

AffectedLayer = Literal["frontend", "backend", "fullstack"]


class FileRef(TypedDict):
    """Entrada no manifesto — conteúdo vive no workspace, não no state."""

    path: str
    sha256: str
    size: int
    lang: str


class ArchitectPlan(TypedDict, total=False):
    """Plano de execução estruturado — só paths relevantes ao turno."""

    stack: StackId
    scope: str
    feature: str
    execution_plan: dict[str, Any]
    files_to_create: list[str]
    files_to_modify: list[str]
    targets: list[str]
    mkdirs: list[str]
    rationale: str
    npm_packages: list[str]
    go_modules: list[str]
    backend_routes: list[dict[str, Any]]
    frontend_changes: list[dict[str, Any]]
    excluded_note: str


class CompileErrorDigest(TypedDict, total=False):
    """Erro de compilação reduzido (não enviar log completo ao LLM)."""

    path: str | None
    line: int | None
    column: int | None
    code: str
    message: str


class PendingWrite(TypedDict):
    op: Literal["write", "mkdir"]
    path: str
    content: str | None


class DevWorkflowState(TypedDict, total=False):
    """Estado LangGraph do workflow de desenvolvimento."""

    user_prompt: str
    # Prompt Enricher (opcional): preserva pedido cru + brief produtificado
    raw_user_prompt: str
    enriched_prompt: str
    enriched_brief: dict[str, Any]
    enrichment_skipped: bool
    model_provider: str | None
    workspace_id: str | None
    preview_console_block: str | None
    preview_console_logs: list[dict[str, Any]] | None

    conversation_digest: str
    project_digest: str
    file_manifest: list[FileRef]

    compact_context_map: dict[str, Any]
    diff_instructions: list[dict[str, Any]]
    use_diff_mode: bool
    project_file_tree: list[str]
    project_files: dict[str, str]
    project_id: str | None

    # Code RAG — paths e contexto recuperados semanticamente
    rag_relevant_paths: list[str]
    rag_context_block: str | None
    rag_skipped_paths: int

    route: RouteDecision
    affected_layers: AffectedLayer
    stack_hint: StackId | None
    route_confidence: float
    route_reason: str
    feature_summary: str

    plan: ArchitectPlan | None

    pending_writes: list[PendingWrite]
    polvo_code_ops: list[dict[str, Any]]

    compile_ok: bool | None
    error_digest: list[CompileErrorDigest]
    compile_attempt: int
    max_compile_retries: int

    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]

    messages: list[dict[str, Any]]


def content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def infer_lang(path: str) -> str:
    p = path.lower()
    if p.endswith((".tsx", ".jsx")):
        return "tsx"
    if p.endswith(".ts"):
        return "ts"
    if p.endswith(".go"):
        return "go"
    if p.endswith((".js", ".mjs", ".cjs")):
        return "js"
    if p.endswith(".json"):
        return "json"
    if p.endswith(".css"):
        return "css"
    if p.endswith(".html"):
        return "html"
    return "text"


def manifest_from_writes(writes: list[PendingWrite]) -> list[FileRef]:
    refs: list[FileRef] = []
    for w in writes:
        if w.get("op") != "write":
            continue
        path = str(w.get("path", "")).strip()
        if not path:
            continue
        body = w.get("content") or ""
        refs.append(
            {
                "path": path,
                "sha256": content_sha256(body),
                "size": len(body.encode("utf-8")),
                "lang": infer_lang(path),
            },
        )
    return refs


def manifest_from_tree(
    tree: list[str],
    files: dict[str, str] | None = None,
) -> list[FileRef]:
    """Manifesto a partir da árvore (hash só quando temos conteúdo)."""
    refs: list[FileRef] = []
    bodies = files or {}
    for raw in tree:
        path = str(raw).strip().replace("\\", "/").lstrip("/")
        if not path or ".." in path:
            continue
        body = bodies.get(path, "")
        refs.append(
            {
                "path": path,
                "sha256": content_sha256(body) if body else "0000000000000000",
                "size": len(body.encode("utf-8")),
                "lang": infer_lang(path),
            },
        )
    return refs


def merge_manifest(existing: list[FileRef], delta: list[FileRef]) -> list[FileRef]:
    by_path = {r["path"]: r for r in existing}
    for r in delta:
        by_path[r["path"]] = r
    return sorted(by_path.values(), key=lambda x: x["path"])


def truncate_trace(trace: list[str], limit: int = 24) -> list[str]:
    if len(trace) <= limit:
        return trace
    return trace[-limit:]
