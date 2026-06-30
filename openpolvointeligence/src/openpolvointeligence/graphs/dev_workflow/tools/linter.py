"""Linter — reutiliza verificação estática."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.dev_workflow_static_verify import run_static_verify


def run_linter(
    project_files: dict[str, str],
    pending_writes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return run_static_verify(project_files, pending_writes=pending_writes)
