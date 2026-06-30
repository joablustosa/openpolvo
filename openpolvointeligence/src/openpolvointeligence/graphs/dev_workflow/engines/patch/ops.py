"""Patch Engine — validação e normalização de polvo_code_ops."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
    prefix_polvo_code_operations,
    resolve_project_root_for_new_app,
)


def normalize_and_validate_ops(
    operations: list[dict[str, Any]],
    *,
    create_project: bool = False,
    has_workspace: bool = False,
    project_title: str | None = None,
) -> tuple[list[dict[str, Any]], list[str], str | None]:
    """Valida ops e aplica prefixo de project root quando aplicável."""
    valid, errors = validate_polvo_code_operations(operations)
    root = resolve_project_root_for_new_app(
        create_project=create_project,
        has_workspace=has_workspace,
        project_title=project_title,
        operations=valid,
    )
    out = prefix_polvo_code_operations(valid, root) if root else valid
    return out, errors, root
