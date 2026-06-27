"""Parse/normalize/validate determinístico das specs de documento Word (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.documents_full.documents_spec_logic import (
    normalize_document_spec,
    normalize_edit_plan,
    parse_json_block,
    validate_document_spec,
    validate_edit_plan,
)


def test_parse_json_block_fenced() -> None:
    assert parse_json_block('```json\n{"a": 1}\n```') == {"a": 1}


def test_normalize_document_spec_blocks() -> None:
    spec = normalize_document_spec(
        {
            "filename": "rel.docx",
            "title": "Relatório",
            "blocks": [
                {"type": "heading", "level": 1, "text": "Intro"},
                {"type": "paragraph", "text": "Corpo.", "bold_phrases": ["Corpo"]},
                {"type": "bullet_list", "items": ["A", "B"]},
                {"type": "table", "headers": ["X"], "rows": [["1"]]},
            ],
            "page_setup": {"margin_top_in": 1.0},
        }
    )
    assert spec["filename"] == "rel.docx"
    assert len(spec["blocks"]) == 4
    assert spec["page_setup"]["margin_top_in"] == 1.0


def test_normalize_document_spec_skips_invalid_blocks() -> None:
    spec = normalize_document_spec(
        {"blocks": [{"type": "unknown"}, {"type": "paragraph", "text": "ok"}]}
    )
    assert len(spec["blocks"]) == 1


def test_validate_document_spec_empty() -> None:
    assert validate_document_spec({"blocks": []})


def test_validate_document_spec_ok() -> None:
    spec = normalize_document_spec({"blocks": [{"type": "paragraph", "text": "x"}]})
    assert validate_document_spec(spec) == []


def test_normalize_edit_plan() -> None:
    plan = normalize_edit_plan(
        {
            "ops": [
                {"op": "replace_text", "find": "a", "replace": "b"},
                {"op": "bad_op"},
                {"op": "append_block", "block": {"type": "paragraph", "text": "novo"}},
            ]
        }
    )
    assert [o["op"] for o in plan["ops"]] == ["replace_text", "append_block"]


def test_validate_edit_plan() -> None:
    assert validate_edit_plan({"ops": []})
    plan = normalize_edit_plan({"ops": [{"op": "insert_heading", "level": 2, "text": "S"}]})
    assert validate_edit_plan(plan) == []
