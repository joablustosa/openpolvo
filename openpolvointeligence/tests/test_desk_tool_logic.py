"""Testes desk_tool_logic — sandbox paths (M2 TOOL-1.4)."""

import tempfile
from pathlib import Path

import pytest

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk.desk_tool_logic import (
    PathTraversalError,
    execute_tool_local,
    normalize_rel_path,
    resolve_under_workspace,
)


def test_normalize_rel_path_blocks_traversal():
    with pytest.raises(PathTraversalError):
        normalize_rel_path("../etc/passwd")


def test_resolve_under_workspace():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "src").mkdir()
        p = resolve_under_workspace(str(root), "src")
        assert p.is_dir()


def test_filesystem_list_local():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "a.txt").write_text("hi", encoding="utf-8")
        settings = Settings()
        r = execute_tool_local(
            settings,
            tool_name="filesystem_list",
            args={"rel_path": ""},
            workspace_path=str(root),
        )
        assert r["ok"] is True
        names = {e["name"] for e in r["entries"]}
        assert "a.txt" in names


def test_terminal_echo_ok():
    with tempfile.TemporaryDirectory() as tmp:
        settings = Settings()
        r = execute_tool_local(
            settings,
            tool_name="terminal_run",
            args={"command": "echo ok"},
            workspace_path=tmp,
        )
        assert r.get("ok") is True
        assert "ok" in str(r.get("output", ""))


def test_git_status_local():
    import subprocess

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "init"], cwd=tmp, capture_output=True, check=False)
        settings = Settings()
        r = execute_tool_local(
            settings,
            tool_name="git_status",
            args={},
            workspace_path=tmp,
        )
        assert r.get("ok") is True
        assert "output" in r
