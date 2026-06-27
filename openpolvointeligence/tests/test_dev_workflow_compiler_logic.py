"""Testes do Compiler_Checker (parse de logs e selecção de ficheiro)."""

from openpolvointeligence.graphs.dev_workflow.dev_workflow_compiler_logic import (
    build_error_file_excerpt,
    has_compile_errors_in_state,
    merge_compile_sources,
    parse_compile_output,
    pick_primary_error_file,
)


def test_parse_compile_output_vite_path():
    log = "src/App.tsx:12:5 - error TS2322: Type 'string' is not assignable."
    ok, errs = parse_compile_output(log)
    assert ok is False
    assert errs[0]["path"] == "src/App.tsx"
    assert errs[0]["line"] == 12


def test_merge_compile_sources():
    merged = merge_compile_sources(
        "console error",
        "build failed",
        [{"level": "error", "message": "syntax error in App.tsx"}],
    )
    assert "build failed" in merged
    assert "syntax error" in merged


def test_pick_primary_error_file():
    files = {"src/App.tsx": "export default 1;"}
    errs = [{"path": "src/App.tsx", "line": 1, "message": "err"}]
    assert pick_primary_error_file(errs, files) == "src/App.tsx"


def test_build_error_file_excerpt():
    files = {"src/App.tsx": "line1\nline2\nline3"}
    excerpt = build_error_file_excerpt(
        "src/App.tsx",
        files,
        [{"path": "src/App.tsx", "line": 2, "message": "x"}],
        context_lines=1,
    )
    assert "line2" in excerpt
    assert "2|" in excerpt


def test_has_compile_errors_in_state():
    assert has_compile_errors_in_state(None, "error TS2304", None) is True
    assert has_compile_errors_in_state(None, "", None) is False
