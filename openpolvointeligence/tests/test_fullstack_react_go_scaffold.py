"""Testes do scaffold fullstack-react-go."""

from openpolvointeligence.graphs.dev_workflow.fullstack_react_go_scaffold import (
    get_fullstack_react_go_scaffold_files,
    scaffold_supports_stack,
)
from openpolvointeligence.graphs.dev_workflow.scaffold_ops import (
    infer_dev_setup_command,
    merge_scaffold_operations,
)


def test_fullstack_react_go_scaffold_supports_stack():
    assert scaffold_supports_stack("fullstack-react-go")
    assert not scaffold_supports_stack("fullstack-mixed")


def test_fullstack_react_go_scaffold_layout():
    files = get_fullstack_react_go_scaffold_files("Todo App")
    paths = set(files.keys())
    assert "frontend/package.json" in paths
    assert "frontend/vite.config.ts" in paths
    assert "frontend/src/lib/api.ts" in paths
    assert "backend/go.mod" in paths
    assert "backend/cmd/api/main.go" in paths
    assert "backend/internal/transport/http/router.go" in paths
    assert "Makefile" in paths
    assert "dev.ps1" in paths
    assert "127.0.0.1:8080" in files["frontend/vite.config.ts"]


def test_merge_fullstack_react_go_scaffold():
    ops = merge_scaffold_operations(
        [],
        create_project=True,
        stack="fullstack-react-go",
        project_title="Todo",
        existing_paths=set(),
    )
    paths = {o["path"] for o in ops}
    assert "frontend/package.json" in paths
    assert "backend/go.mod" in paths
    assert "Makefile" in paths


def test_infer_dev_setup_make_dev():
    ops = [{"op": "write", "path": "frontend/package.json", "content": "{}"}]
    assert infer_dev_setup_command("fullstack-react-go", ops) == "make dev"
