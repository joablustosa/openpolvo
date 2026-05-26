"""Correcção determinística de layout preview (sem LLM) — espelha openpolvo layoutScaffoldHeal."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_LAYOUT_DIR = Path(__file__).resolve().parent.parent / "scaffold" / "layout"

LAYOUT_SCAFFOLD_PATHS = (
    "src/components/layout/AppShell.tsx",
    "src/components/layout/Navbar.tsx",
    "src/components/layout/Sidebar.tsx",
)

_LAYOUT_IMPORT_ERROR_RE = re.compile(
    r"Failed to resolve import|react-router-dom|react-router|\./Sidebar|\./Navbar|AppShell\.tsx",
    re.I,
)


def _load_layout_scaffold_files() -> dict[str, str]:
    out: dict[str, str] = {}
    mapping = {
        "src/components/layout/AppShell.tsx": "AppShell.tsx",
        "src/components/layout/Navbar.tsx": "Navbar.tsx",
        "src/components/layout/Sidebar.tsx": "Sidebar.tsx",
    }
    for dest, fname in mapping.items():
        path = _LAYOUT_DIR / fname
        if path.is_file():
            out[dest] = path.read_text(encoding="utf-8")
    return out


def build_layout_scaffold_heal_ops(compile_log: str) -> list[dict[str, Any]] | None:
    """Devolve writes de layout se o log indicar import/layout quebrado."""
    if not compile_log.strip() or not _LAYOUT_IMPORT_ERROR_RE.search(compile_log):
        return None

    scaffold = _load_layout_scaffold_files()
    ops: list[dict[str, Any]] = []
    for path in LAYOUT_SCAFFOLD_PATHS:
        content = scaffold.get(path)
        if content:
            ops.append({"op": "write", "path": path, "content": content})
    return ops or None

