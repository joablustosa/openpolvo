"""Triagem do bug-fix team (detect) — determinística, zero-token.

Primeiro passo do workflow `debug`. Antes de corrigir, o time "detecta":
- classifica a categoria do bug (runtime | integration | logic | unknown);
- extrai o sinal de falha (linha de erro/stack trace do pedido do utilizador);
- localiza ficheiros suspeitos (heurística sobre o pedido × ``project_files``);
- consulta a memória de erros (pares erro→fix), quando disponível.

Produz ``bugfix_report`` no state, consumido no verify e no relatório final. Dar ao
fixer um alvo concreto (erro + suspeitos) torna a correção mais precisa e o verify
mais fiável — o mesmo padrão "reproduce/localize before fixing" do Claude/Cursor.
"""

from __future__ import annotations

import re
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.base import step_patch
from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_state import DevWorkflowState
from openpolvointeligence.graphs.dev_workflow.core.workflow_helpers import triage_bug_category

# Padrões comuns de linha de erro / stack trace (JS/TS/Python).
_ERROR_LINE_RE = re.compile(
    r"(?im)^.*("
    r"error\b|exception\b|traceback|typeerror|referenceerror|"
    r"cannot read|is not (?:a function|defined)|unhandled|"
    r"\b[45]\d\d\b"
    r").*$"
)

# Caminho de ficheiro citado no texto (ex.: src/App.tsx, app/api/user.py).
_PATH_RE = re.compile(r"[\w./-]+\.[a-zA-Z]{1,6}")

MAX_SUSPECTS = 8


def _extract_error_signal(prompt: str) -> str:
    """Primeira linha que pareça erro/stack trace; senão a 1ª linha não vazia."""
    for m in _ERROR_LINE_RE.finditer(prompt or ""):
        line = m.group(0).strip()
        if line:
            return line[:400]
    for line in (prompt or "").splitlines():
        if line.strip():
            return line.strip()[:400]
    return ""


def _locate_suspects(prompt: str, project_files: dict[str, str]) -> list[str]:
    """Ficheiros do projecto citados no pedido (match por caminho ou nome base)."""
    if not project_files:
        return []
    files = set(project_files)
    suspects: list[str] = []
    seen: set[str] = set()
    low = (prompt or "").lower()
    # 1) caminhos citados que existem no projecto.
    for raw in _PATH_RE.findall(prompt or ""):
        norm = raw.strip().replace("\\", "/").lstrip("./")
        for f in files:
            if f == norm or f.endswith("/" + norm) or f.endswith(norm):
                if f not in seen:
                    seen.add(f)
                    suspects.append(f)
    # 2) nomes de ficheiro (basename) mencionados livremente.
    if len(suspects) < MAX_SUSPECTS:
        for f in sorted(files):
            base = f.rsplit("/", 1)[-1].lower()
            if len(base) >= 4 and base in low and f not in seen:
                seen.add(f)
                suspects.append(f)
            if len(suspects) >= MAX_SUSPECTS:
                break
    return suspects[:MAX_SUSPECTS]


async def run_bugfix_triage_agent(settings: Settings, state: DevWorkflowState) -> dict[str, Any]:
    """Detect: classifica, extrai sinal e localiza suspeitos (sem LLM)."""
    prompt = str(state.get("user_prompt") or state.get("raw_user_prompt") or "")
    category = triage_bug_category(prompt)
    signal = _extract_error_signal(prompt)
    suspects = _locate_suspects(prompt, dict(state.get("project_files") or {}))

    known_fixes: list[dict[str, Any]] = []
    if bool(getattr(settings, "dev_workflow_error_memory_enabled", True)) and signal:
        try:
            from openpolvointeligence.graphs.dev_workflow.dev_workflow_error_memory import (
                recall_similar_errors,
            )

            digest = [{"message": signal, "path": suspects[0] if suspects else ""}]
            recalled = await recall_similar_errors(
                settings, state.get("project_id"), digest, top_k=3
            )
            known_fixes = [r for r in recalled if r.get("fix_summary")]
        except Exception:  # noqa: BLE001 — memória é auxiliar; nunca deve derrubar a triagem
            known_fixes = []

    report: dict[str, Any] = {
        "phase": "detect",
        "category": category,
        "symptom": signal,
        "suspect_paths": suspects,
        "known_fixes": known_fixes[:3],
    }
    return step_patch(
        state,
        "triage",
        {"bug_category": category, "bugfix_report": report},
        agent="triage",
    )
