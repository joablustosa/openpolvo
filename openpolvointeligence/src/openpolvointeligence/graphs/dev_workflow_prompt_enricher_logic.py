"""Prompt_Enricher — produtifica pedidos vagos/curtos antes do Dev Workflow."""

from __future__ import annotations

import re
from typing import Any

from openpolvointeligence.graphs.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.message_utils import last_user_text

_WS_RE = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip())


def should_enrich(state: DevWorkflowState, raw_user_prompt: str | None = None) -> bool:
    """Heurística: enriquecer apenas quando faz sentido (novo/curto/vago).

    Regras principais:
    - Projecto novo (sem árvore/manifesto) → enriquecer.
    - Pedido curto (< 60 chars) → enriquecer.
    - Retries/self-heal (compile_attempt>0) → não enriquecer (evita ruído no patch).
    """

    attempt = int(state.get("compile_attempt") or 0)
    if attempt > 0:
        return False

    tree = state.get("project_file_tree") or []
    manifest = state.get("file_manifest") or []
    has_project = bool(tree) or bool(manifest)

    raw = _norm(raw_user_prompt or state.get("raw_user_prompt") or state.get("user_prompt") or "")
    if not raw:
        # Sem pedido, não há o que enriquecer.
        return False

    if not has_project:
        return True

    # Pedido curto ou muito vago em projecto existente.
    if len(raw) < 60:
        return True

    # Se parecer já detalhado (múltiplas frases/itens), não enriquecer.
    if (
        raw.count(".") >= 2
        or raw.count("\n") >= 2
        or any(k in raw.lower() for k in ("objetivo", "público", "seções", "secções"))
    ):
        return False

    # Perguntas muito abertas (“faz um site”, “melhora isso”) beneficiam.
    vague_markers = (
        "melhorar",
        "ajustar",
        "criar um site",
        "cria um site",
        "criar landing",
        "faz uma landing",
        "faz uma pagina",
        "fazer uma página",
        "tá feio",
        "ta feio",
        "precisa melhorar",
    )
    return any(v in raw.lower() for v in vague_markers)


def normalize_enriched_prompt(data: dict[str, Any], *, raw: str) -> dict[str, Any]:
    """Normaliza e limita o JSON do Prompt_Enricher."""

    def s(key: str, max_len: int) -> str:
        return _norm(str(data.get(key) or ""))[:max_len]

    def list_s(key: str, max_n: int, max_item: int) -> list[str]:
        v = data.get(key)
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for item in v:
            t = _norm(str(item or ""))[:max_item]
            if t and t not in out:
                out.append(t)
            if len(out) >= max_n:
                break
        return out

    objective = s("objective", 240)
    audience = s("audience", 200)
    tone = s("tone", 80) or "profissional"
    palette_hint = s("palette_hint", 40) or "zinc"
    layout_shell = s("layout_shell", 24) or "marketing"
    sections = list_s("sections", 8, 40)
    full_prompt = _norm(str(data.get("full_prompt") or ""))[:4000] or _norm(raw)[:4000]

    # Safety: restringir valores.
    if layout_shell not in ("marketing", "dashboard"):
        layout_shell = "marketing"
    if palette_hint not in ("zinc", "slate", "neutral", "stone"):
        palette_hint = "zinc"

    return {
        "objective": objective,
        "audience": audience,
        "sections": sections,
        "tone": tone,
        "palette_hint": palette_hint,
        "layout_shell": layout_shell,
        "full_prompt": full_prompt,
    }


def build_raw_user_prompt(messages: list[dict[str, Any]] | None) -> str:
    return _norm(last_user_text(messages or [], 4000))
