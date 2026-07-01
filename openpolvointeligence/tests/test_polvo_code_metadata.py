"""Testes mínimos para validação de operações Polvo Code (metadata)."""

from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    build_polvo_code_ops_metadata,
    validate_polvo_code_operations,
)
from openpolvointeligence.graphs.dev_workflow import polvo_code_metadata as pcm


def test_validate_write_ok():
    raw = [{"op": "write", "path": "src/App.tsx", "content": "export {}\n"}]
    valid, errs = validate_polvo_code_operations(raw)
    assert not errs
    assert len(valid) == 1
    assert valid[0]["op"] == "write"


def test_validate_rejects_traversal():
    raw = [{"op": "write", "path": "../evil.txt", "content": "x"}]
    valid, errs = validate_polvo_code_operations(raw)
    assert not valid
    assert errs


def test_infer_create_project_and_npm_from_writes():
    ops = [
        {"op": "write", "path": "package.json", "content": "{}"},
        {"op": "write", "path": "src/main.tsx", "content": "x"},
    ]
    assert pcm._infer_create_project(ops, False) is True
    assert pcm._infer_npm_install(ops, False) is True


def test_infer_create_project_false_without_main():
    ops = [{"op": "write", "path": "package.json", "content": "{}"}]
    assert pcm._infer_create_project(ops, False) is False


def test_build_metadata_pending_opens_native_plugin():
    meta = build_polvo_code_ops_metadata(
        True,
        [{"op": "write", "path": "a.ts", "content": "//"}],
        [],
        create_project=True,
        project_title="demo",
        npm_install=True,
    )
    assert meta["polvo_code_ops_pending"] is True
    assert meta["native_plugin"]["id"] == "dev_studio"
    assert meta["polvo_code_create_project"] is True
    assert meta["polvo_code_git_init"] is True


def test_build_metadata_pending_with_partial_validation_warnings():
    ops = [{"op": "write", "path": "a.ts", "content": "//"}]
    meta = build_polvo_code_ops_metadata(
        True,
        ops,
        ["patch[0]: old_text não encontrado"],
        create_project=False,
    )
    assert meta["polvo_code_ops_pending"] is True
    assert meta["polvo_code_ops_blocked"] is False
    assert meta["polvo_code_ops"] == ops


def test_build_metadata_blocked_when_no_ops():
    meta = build_polvo_code_ops_metadata(True, [], ["sem operações"])
    assert meta["polvo_code_ops_pending"] is False
    assert meta["polvo_code_ops_blocked"] is True
