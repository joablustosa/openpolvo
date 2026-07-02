"""Ferramentas de edição cirúrgica do agente Desk — filesystem_edit / multi_edit.

Semântica Claude Code: old_text único no ficheiro; multi_edit atómico
(todas-ou-nenhuma). Sem LLM real; ficheiros em diretório temporário.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk.desk_tool_logic import (
    apply_unique_edits,
    desk_langchain_tools,
    execute_tool_local,
)


# ── Lógica pura ──────────────────────────────────────────────────────────────


def test_apply_unique_edit_success():
    out, err = apply_unique_edits("a = 1\nb = 2\n", [{"old_text": "b = 2", "new_text": "b = 3"}])
    assert err is None
    assert out == "a = 1\nb = 3\n"


def test_apply_edits_sequential():
    # A 2ª edição vê o resultado da 1ª.
    out, err = apply_unique_edits(
        "x\n",
        [
            {"old_text": "x", "new_text": "y"},
            {"old_text": "y", "new_text": "z"},
        ],
    )
    assert err is None
    assert out == "z\n"


def test_apply_edit_not_found():
    out, err = apply_unique_edits("abc", [{"old_text": "zzz", "new_text": "y"}])
    assert out is None
    assert err["error"] == "old_text_not_found"


def test_apply_edit_ambiguous():
    out, err = apply_unique_edits("foo foo", [{"old_text": "foo", "new_text": "bar"}])
    assert out is None
    assert err["error"] == "old_text_ambiguous"
    assert "2" in err["hint"]


def test_apply_edit_empty_cases():
    assert apply_unique_edits("abc", [])[1]["error"] == "empty_edits"
    assert apply_unique_edits("abc", [{"old_text": "", "new_text": "x"}])[1]["error"] == (
        "empty_old_text"
    )


# ── Execução local em disco ──────────────────────────────────────────────────


def _ws() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory()


def test_filesystem_edit_local():
    with _ws() as tmp:
        f = Path(tmp) / "app.py"
        f.write_text("value = 1\nprint(value)\n", encoding="utf-8")
        r = execute_tool_local(
            Settings(),
            tool_name="filesystem_edit",
            args={"rel_path": "app.py", "old_text": "value = 1", "new_text": "value = 42"},
            workspace_path=tmp,
        )
        assert r["ok"] is True
        assert f.read_text(encoding="utf-8") == "value = 42\nprint(value)\n"


def test_filesystem_multi_edit_atomic_failure_leaves_file_intact():
    with _ws() as tmp:
        f = Path(tmp) / "cfg.ts"
        original = "const a = 1;\nconst b = 2;\n"
        f.write_text(original, encoding="utf-8")
        r = execute_tool_local(
            Settings(),
            tool_name="filesystem_multi_edit",
            args={
                "rel_path": "cfg.ts",
                "edits": [
                    {"old_text": "const a = 1;", "new_text": "const a = 10;"},
                    {"old_text": "NÃO EXISTE", "new_text": "x"},
                ],
            },
            workspace_path=tmp,
        )
        assert r["ok"] is False
        assert r["error"] == "old_text_not_found"
        # Atómico: a 1ª edição não pode ter sido gravada.
        assert f.read_text(encoding="utf-8") == original


def test_filesystem_multi_edit_success():
    with _ws() as tmp:
        f = Path(tmp) / "doc.md"
        f.write_text("# Título\n\ntexto antigo\n\nfim\n", encoding="utf-8")
        r = execute_tool_local(
            Settings(),
            tool_name="filesystem_multi_edit",
            args={
                "rel_path": "doc.md",
                "edits": [
                    {"old_text": "# Título", "new_text": "# Novo título"},
                    {"old_text": "texto antigo", "new_text": "texto novo"},
                ],
            },
            workspace_path=tmp,
        )
        assert r["ok"] is True
        assert f.read_text(encoding="utf-8") == "# Novo título\n\ntexto novo\n\nfim\n"


def test_filesystem_edit_missing_file_hints_write():
    with _ws() as tmp:
        r = execute_tool_local(
            Settings(),
            tool_name="filesystem_edit",
            args={"rel_path": "novo.txt", "old_text": "a", "new_text": "b"},
            workspace_path=tmp,
        )
        assert r["ok"] is False
        assert r["error"] == "not_a_file"
        assert "filesystem_write" in r["hint"]


def test_filesystem_edit_blocks_traversal():
    with _ws() as tmp:
        r = execute_tool_local(
            Settings(),
            tool_name="filesystem_edit",
            args={"rel_path": "../fora.txt", "old_text": "a", "new_text": "b"},
            workspace_path=tmp,
        )
        assert r["ok"] is False


# ── Registo no agente ────────────────────────────────────────────────────────


def test_desk_advertises_edit_tools():
    names = {t.name for t in desk_langchain_tools(Settings())}
    assert {"filesystem_edit", "filesystem_multi_edit"} <= names
    # As tools existentes continuam presentes.
    assert {"filesystem_read", "filesystem_write", "filesystem_list"} <= names
