"""Scaffold Go API."""

from openpolvointeligence.graphs.dev_workflow.go_api_scaffold import scaffold_supports_stack
from openpolvointeligence.graphs.dev_workflow.scaffold_ops import merge_scaffold_operations


def test_go_scaffold_supports_stack():
    assert scaffold_supports_stack("go-api")
    assert not scaffold_supports_stack("vite-react")


def test_merge_go_scaffold_for_new_app():
    ops = merge_scaffold_operations(
        [],
        create_project=True,
        stack="go-api",
        project_title="Minha API",
        existing_paths=set(),
    )
    paths = {o["path"] for o in ops}
    assert "go.mod" in paths
    assert "main.go" in paths
