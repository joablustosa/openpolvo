from openpolvointeligence.graphs.dev_workflow.scaffold_ops import merge_scaffold_operations
from openpolvointeligence.graphs.dev_workflow.vite_react_scaffold import (
    build_app_tsx_from_pages,
    get_vite_react_scaffold_files,
)


def test_vite_scaffold_includes_package_json_and_ui() -> None:
    files = get_vite_react_scaffold_files("minha-app", stack="vite-react")
    assert "package.json" in files
    assert "vite.config.ts" in files
    assert "src/main.tsx" in files
    assert "src/components/ui/button.tsx" in files
    assert "server/index.ts" not in files


def test_fullstack_scaffold_includes_server() -> None:
    files = get_vite_react_scaffold_files("api-app", stack="fullstack-mixed")
    assert "server/index.ts" in files
    assert "src/lib/api.ts" in files


def test_build_app_tsx_from_pages() -> None:
    app = build_app_tsx_from_pages(["src/pages/LandingPage.tsx"])
    assert "LandingPage" in app
    assert 'path="/"' in app
    assert "AppShell" in app


def test_merge_scaffold_prepends_standard_repo_for_new_app() -> None:
    llm_ops = [
        {
            "op": "write",
            "path": "src/pages/LandingPage.tsx",
            "content": "export default function LandingPage(){return null}\n",
        },
    ]
    merged = merge_scaffold_operations(
        llm_ops,
        create_project=True,
        stack="vite-react",
        project_title="Festas Kids",
        design_tokens={"accent": "violet"},
    )
    paths = [o["path"] for o in merged if o.get("op") == "write"]
    assert "package.json" in paths
    assert "src/pages/LandingPage.tsx" in paths
    assert paths.index("package.json") < paths.index("src/pages/LandingPage.tsx")


def test_merge_scaffold_skips_when_package_json_exists() -> None:
    llm_ops = [{"op": "write", "path": "src/App.tsx", "content": "x"}]
    merged = merge_scaffold_operations(
        llm_ops,
        create_project=True,
        stack="vite-react",
        project_title="App",
        existing_paths={"package.json"},
    )
    assert merged == llm_ops
