"""Filesystem tool — opera sobre project_files no estado (sem I/O directo no servidor)."""

from __future__ import annotations

from typing import Any


def _norm(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def read_file(project_files: dict[str, str], path: str) -> str | None:
    key = _norm(path)
    return project_files.get(key)


def write_file(project_files: dict[str, str], path: str, content: str) -> dict[str, str]:
    out = dict(project_files)
    out[_norm(path)] = content
    return out


def file_exists(project_files: dict[str, str], path: str) -> bool:
    return _norm(path) in project_files


def _match_glob(path: str, globs: list[str]) -> bool:
    if not globs:
        return True
    for g in globs:
        g = g.lstrip("*.")
        if path.endswith(f".{g}") or g in path:
            return True
    return False


def grep_in_memory(
    project_files: dict[str, str],
    pattern: str,
    *,
    globs: list[str] | None = None,
    max_matches: int = 80,
) -> str:
    """grep -rn simulado sobre project_files."""
    import re

    try:
        rx = re.compile(pattern)
    except re.error:
        return ""
    lines_out: list[str] = []
    for path in sorted(project_files):
        if not _match_glob(path, globs or []):
            continue
        for i, line in enumerate(project_files[path].splitlines(), start=1):
            if rx.search(line):
                lines_out.append(f"{path}:{i}:{line[:200]}")
                if len(lines_out) >= max_matches:
                    return "\n".join(lines_out)
    return "\n".join(lines_out)


def list_files_in_memory(
    project_files: dict[str, str],
    *,
    prefix: str = "src",
    limit: int = 200,
) -> str:
    root = _norm(prefix).rstrip("/")
    paths = sorted(p for p in project_files if not root or p == root or p.startswith(f"{root}/"))
    return "\n".join(paths[:limit])


def list_directory(project_files: dict[str, str], prefix: str = "") -> list[dict[str, Any]]:
    root = _norm(prefix)
    entries: list[dict[str, Any]] = []
    seen_dirs: set[str] = set()
    for raw in project_files:
        p = _norm(raw)
        if root and not p.startswith(f"{root}/") and p != root:
            continue
        rel = p[len(root) + 1 :] if root and p.startswith(f"{root}/") else p
        if not rel:
            continue
        head = rel.split("/")[0]
        if "/" in rel:
            if head not in seen_dirs:
                seen_dirs.add(head)
                entries.append({"name": head, "type": "dir"})
        else:
            entries.append({"name": rel, "type": "file"})
    return entries
