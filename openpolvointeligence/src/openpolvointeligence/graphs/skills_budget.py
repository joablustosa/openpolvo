"""Catálogo de skills (Markdown) com orçamento de caracteres — paridade leve com SkillTool do Claude Code.

Procura pastas `**/SKILL.md` sob raízes configuradas (`OP_SKILLS_SCAN_ROOTS`, lista separada por `;`
ou `,`). Se vazio, sobe directórios a partir deste módulo até encontrar `.cursor/skills`.

Ordem: primeira raiz na lista ganha; dentro de cada raiz, ordem alfabética por caminho.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

# Orçamento total injectável no system prompt (nome + excerto por skill).
_DEFAULT_BUDGET_CHARS = 6000
_MAX_SKILLS = 24
_HEAD_LINES = 42


def _parse_roots(raw: str) -> list[Path]:
    roots: list[Path] = []
    for part in re.split(r"[;,]", raw or ""):
        p = Path(part.strip())
        if p.is_dir():
            roots.append(p.resolve())
    return roots


def _discover_default_skills_root() -> Path | None:
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        cand = parent / ".cursor" / "skills"
        if cand.is_dir():
            return cand.resolve()
    return None


def _iter_skill_files(roots: list[Path]) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for root in roots:
        try:
            for f in sorted(root.rglob("SKILL.md")):
                key = str(f.resolve())
                if key in seen:
                    continue
                seen.add(key)
                out.append(f)
                if len(out) >= _MAX_SKILLS * 4:
                    break
        except OSError:
            continue
    return out


def _head_of_skill(text: str, max_lines: int = _HEAD_LINES) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[:max_lines]) + "\n…"


@lru_cache
def _roots_from_settings_key(scan_roots: str) -> tuple[Path, ...]:
    roots = _parse_roots(scan_roots)
    if not roots:
        d = _discover_default_skills_root()
        if d is not None:
            roots = [d]
    return tuple(roots)


def load_skills_catalog(
    *,
    scan_roots: str = "",
    budget_chars: int = _DEFAULT_BUDGET_CHARS,
) -> str:
    """Devolve bloco Markdown curto listando skills (nome + excerto) até `budget_chars`."""
    roots = list(_roots_from_settings_key((scan_roots or "").strip()))
    if not roots:
        return ""
    files = _iter_skill_files(roots)[:_MAX_SKILLS]
    if not files:
        return ""
    parts: list[str] = []
    used = 0
    for fp in files:
        name = fp.parent.name if fp.name.upper() == "SKILL.MD" else fp.stem
        try:
            raw = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        head = _head_of_skill(raw)
        block = f"### skill:{name}\n_path: `{fp.as_posix()}`\n{head}\n"
        if used + len(block) > budget_chars:
            remain = budget_chars - used - 80
            if remain < 200:
                break
            block = block[:remain] + "\n…[truncado por orçamento]\n"
        parts.append(block)
        used += len(block)
        if used >= budget_chars:
            break
    if not parts:
        return ""
    header = (
        "## Skills disponíveis (ler o SKILL.md completo no repositório quando for relevante)\n"
        f"_Orçamento aproximado: {budget_chars} caracteres. Não inventes paths — usa os `_path` abaixo._\n\n"
    )
    return header + "\n".join(parts)


def skills_block_for_prompt(settings: Any) -> str:
    """Usa Settings (opcional) para `OP_SKILLS_SCAN_ROOTS` e orçamento."""
    raw = ""
    budget = _DEFAULT_BUDGET_CHARS
    if settings is not None:
        raw = str(getattr(settings, "skills_scan_roots", "") or "")
        b = getattr(settings, "skills_prompt_budget_chars", None)
        if b is not None:
            try:
                budget = max(500, int(b))
            except (TypeError, ValueError):
                budget = _DEFAULT_BUDGET_CHARS
    return load_skills_catalog(scan_roots=raw, budget_chars=budget)
