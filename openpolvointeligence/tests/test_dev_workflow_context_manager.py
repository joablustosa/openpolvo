"""Testes do Context_Manager (extracção estrutural + unified diff)."""

from openpolvointeligence.graphs.dev_workflow_context_manager import (
    apply_unified_diff,
    build_structural_index,
    diff_instructions_to_writes,
    extract_file_structure,
    prioritize_paths,
)


def test_extract_ts_signatures_and_routes():
    src = """
export function App(): JSX.Element {
  return null;
}
export const API_URL = "x";
router.get('/api/health', handler);
"""
    st = extract_file_structure("src/App.tsx", src)
    assert any("App" in s for s in st["signatures"])
    assert any("GET" in r for r in st["routes"])


def test_build_structural_index_without_bodies():
    tree = ["src/App.tsx", "package.json"]
    files = {
        "src/App.tsx": "export function App() { return 1; }",
        "package.json": '{"name":"demo","dependencies":{"react":"^18"}}',
    }
    idx = build_structural_index(tree, files)
    assert idx["indexed_count"] == 2
    assert "react" in str(idx["files"]["package.json"]["exports"])


def test_prioritize_paths_puts_package_first():
    ordered = prioritize_paths(["src/foo.ts", "package.json", "src/App.tsx"])
    assert ordered[0] == "package.json"


def test_apply_unified_diff():
    original = "line1\nline2\nline3\n"
    diff = """--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2changed
 line3
+line4
"""
    patched = apply_unified_diff(original, diff)
    assert patched is not None
    assert "line2changed" in patched
    assert "line4" in patched


def test_diff_instructions_to_writes():
    base = {"src/App.tsx": "export function App() {\n  return null;\n}\n"}
    diff = """--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,3 @@
 export function App() {
-  return null;
+  return <main />;
 }
"""
    instr = [{"path": "src/App.tsx", "change_type": "patch", "unified_diff": diff}]
    writes = diff_instructions_to_writes(instr, base)
    assert len(writes) == 1
    assert "<main />" in writes[0]["content"]
