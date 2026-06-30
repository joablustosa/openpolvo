"""Carrega skills OpenPolvo como contexto injectável."""

from __future__ import annotations

import os
from pathlib import Path


def discover_skill_paths(extra_roots: str = "") -> list[Path]:
    roots: list[Path] = []
    env = (extra_roots or os.environ.get("OP_SKILLS_SCAN_ROOTS", "")).strip()
    if env:
        for part in env.replace(",", ";").split(";"):
            p = Path(part.strip())
            if p.is_dir():
                roots.append(p)
    # monorepo default
    here = Path(__file__).resolve()
    for _ in range(8):
        candidate = here / ".cursor" / "skills"
        if candidate.is_dir():
            roots.append(candidate)
            break
        here = here.parent
    return roots


def load_skills_snippet(max_chars: int = 4000) -> str:
    parts: list[str] = []
    for root in discover_skill_paths():
        for skill_md in sorted(root.rglob("SKILL.md"))[:12]:
            try:
                text = skill_md.read_text(encoding="utf-8")[:400]
                parts.append(f"## {skill_md.parent.name}\n{text}")
            except OSError:
                continue
    body = "\n\n".join(parts)
    return body[:max_chars]
