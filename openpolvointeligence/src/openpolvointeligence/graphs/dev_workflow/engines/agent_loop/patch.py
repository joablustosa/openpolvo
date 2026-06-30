"""Aplicação de patches search_replace em project_files."""

from __future__ import annotations


def apply_search_replace(
    project_files: dict[str, str],
    path: str,
    old_text: str,
    new_text: str,
) -> tuple[dict[str, str], str | None]:
    """Substitui old_text por new_text no ficheiro. Devolve (files, erro)."""
    key = path.strip().replace("\\", "/").lstrip("/")
    content = project_files.get(key)
    if content is None:
        return project_files, f"ficheiro não encontrado: {key}"
    if old_text not in content:
        return project_files, f"old_text não encontrado em {key}"
    updated = dict(project_files)
    updated[key] = content.replace(old_text, new_text, 1)
    return updated, None
