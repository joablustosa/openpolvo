from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
)
from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
    build_project_root_path,
    prefix_polvo_code_operations,
    resolve_existing_project_root,
    resolve_project_root_for_new_app,
    slugify_project_title,
)


def test_slugify_project_title() -> None:
    assert slugify_project_title("Festas Kids!") == "festas-kids"
    assert slugify_project_title("") == "openpolvo-app"


def test_build_project_root_path() -> None:
    assert build_project_root_path("festas-kids") == "projects/festas-kids"
    assert build_project_root_path("projects/demo-app") == "projects/demo-app"


def test_prefix_polvo_code_operations_adds_root_folder() -> None:
    ops = [{"op": "write", "path": "src/main.tsx", "content": "x"}]
    out = prefix_polvo_code_operations(ops, "projects/festas-kids")
    paths = [o["path"] for o in out]
    assert "projects" in paths
    assert "projects/festas-kids" in paths
    assert "projects/festas-kids/src/main.tsx" in paths


def test_build_polvo_code_metadata_includes_project_root_in_workspace() -> None:
    meta = build_polvo_code_ops_metadata(
        True,
        [{"op": "write", "path": "package.json", "content": "{}"}],
        [],
        create_project=True,
        project_title="Demo App",
        has_workspace=True,
    )
    assert meta["polvo_code_project_root"] == "projects/demo-app"
    write_paths = [o["path"] for o in meta["polvo_code_ops"] if o.get("op") == "write"]
    assert any(p.startswith("projects/demo-app/") for p in write_paths)


def test_resolve_project_root_skips_without_workspace() -> None:
    assert (
        resolve_project_root_for_new_app(
            create_project=True,
            has_workspace=False,
            project_title="Demo",
            operations=[],
        )
        is None
    )


def test_resolve_existing_project_root_from_state() -> None:
    root = resolve_existing_project_root(
        {"polvo_code_project_root": "projects/my-app", "project_files": {}},
        create_project=False,
    )
    assert root == "projects/my-app"


def test_resolve_existing_project_root_from_files() -> None:
    root = resolve_existing_project_root(
        {
            "project_files": {
                "projects/foo/src/App.tsx": "x",
                "projects/foo/package.json": "{}",
            }
        },
        create_project=False,
    )
    assert root == "projects/foo"
