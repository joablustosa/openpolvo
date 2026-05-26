from openpolvointeligence.graphs.layout_scaffold_heal_logic import (
    build_layout_scaffold_heal_ops,
)


def test_heal_sidebar_missing_import():
    log = (
        '[plugin:vite:import-analysis] Failed to resolve import "./Sidebar" '
        'from "src/components/layout/AppShell.tsx"'
    )
    ops = build_layout_scaffold_heal_ops(log)
    assert ops is not None
    paths = {o["path"] for o in ops}
    assert "src/components/layout/AppShell.tsx" in paths
    app = next(o for o in ops if o["path"].endswith("AppShell.tsx"))
    assert 'import Sidebar from "./Sidebar"' not in app["content"]
    assert "SidebarPanel" in app["content"]


def test_heal_skips_unrelated_log():
    assert build_layout_scaffold_heal_ops("Build completed successfully") is None
