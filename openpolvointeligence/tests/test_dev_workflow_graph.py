"""Testes do grafo de desenvolvimento (lógica pura, sem LLM)."""

from openpolvointeligence.graphs.dev_workflow_compiler_logic import parse_compile_output
from openpolvointeligence.graphs.dev_workflow_graph import (
    _normalize_route,
    _normalize_stack,
    route_after_compiler,
    route_after_router,
)
from openpolvointeligence.graphs.dev_workflow_state import (
    content_sha256,
    manifest_from_writes,
    merge_manifest,
)


def test_parse_compile_output_extracts_errors():
    log = """
    src/App.tsx:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.
    Build failed with errors.
    """
    ok, errs = parse_compile_output(log)
    assert ok is False
    assert len(errs) >= 1
    assert "TS2322" in errs[0]["message"] or "error" in errs[0]["message"].lower()


def test_parse_compile_output_empty_is_ok():
    ok, errs = parse_compile_output("")
    assert ok is True
    assert errs == []


def test_normalize_route():
    assert _normalize_route("patch") == "patch"
    assert _normalize_route("unknown") == "architect"


def test_normalize_stack():
    assert _normalize_stack("next-react") == "next-react"
    assert _normalize_stack("invalid") is None


def test_route_after_router_patch():
    assert route_after_router({"route": "patch"}) == "code_generator"


def test_route_after_compiler_retry():
    fn = route_after_compiler
    assert fn({"compile_ok": True, "compile_attempt": 1}) == "context_finalize"
    assert fn({"compile_ok": False, "compile_attempt": 1, "max_compile_retries": 2}) == "retry_self_heal"
    assert fn({"compile_ok": False, "compile_attempt": 2, "max_compile_retries": 2}) == "context_finalize"


def test_manifest_merge():
    writes = [{"op": "write", "path": "src/App.tsx", "content": "export default 1;"}]
    delta = manifest_from_writes(writes)  # type: ignore[arg-type]
    merged = merge_manifest([], delta)
    assert len(merged) == 1
    assert merged[0]["path"] == "src/App.tsx"
    assert merged[0]["sha256"] == content_sha256("export default 1;")
