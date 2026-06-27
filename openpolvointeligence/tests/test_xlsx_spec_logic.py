"""Parse/normalize/validate determinístico das specs de planilha (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.xlsx_full.xlsx_spec_logic import (
    normalize_edit_plan,
    normalize_workbook_spec,
    parse_json_block,
    validate_edit_plan,
    validate_workbook_spec,
)


def test_parse_json_block_plain() -> None:
    assert parse_json_block('{"a": 1}') == {"a": 1}


def test_parse_json_block_fenced() -> None:
    assert parse_json_block('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_json_block_embedded() -> None:
    assert parse_json_block('Aqui está: {"a": 1} fim') == {"a": 1}


def test_parse_json_block_invalid_returns_empty() -> None:
    assert parse_json_block("sem json") == {}
    assert parse_json_block("") == {}


def test_normalize_workbook_spec_basic() -> None:
    spec = normalize_workbook_spec(
        {
            "filename": "orc.xlsx",
            "sheets": [
                {
                    "name": "Orçamento",
                    "columns": ["Item", "Valor"],
                    "rows": [["A", 10], ["B", 20]],
                    "number_formats": {"b": "#,##0.00"},
                }
            ],
        }
    )
    assert spec["filename"] == "orc.xlsx"
    assert len(spec["sheets"]) == 1
    sheet = spec["sheets"][0]
    assert sheet["columns"] == ["Item", "Valor"]
    assert sheet["rows"] == [["A", 10], ["B", 20]]
    assert sheet["number_formats"] == {"B": "#,##0.00"}
    assert sheet["freeze_header"] is True


def test_normalize_workbook_spec_flattened_single_sheet() -> None:
    spec = normalize_workbook_spec({"columns": ["A"], "rows": [[1]]})
    assert len(spec["sheets"]) == 1
    assert spec["sheets"][0]["columns"] == ["A"]


def test_normalize_workbook_spec_rows_from_dicts() -> None:
    spec = normalize_workbook_spec(
        {"sheets": [{"name": "S", "columns": ["x", "y"], "rows": [{"x": 1, "y": 2}]}]}
    )
    assert spec["sheets"][0]["rows"] == [[1, 2]]


def test_validate_workbook_spec_empty() -> None:
    errors = validate_workbook_spec({"sheets": []})
    assert errors


def test_validate_workbook_spec_ok() -> None:
    spec = normalize_workbook_spec({"sheets": [{"name": "S", "columns": ["A"], "rows": [[1]]}]})
    assert validate_workbook_spec(spec) == []


def test_normalize_edit_plan_filters_invalid_ops() -> None:
    plan = normalize_edit_plan(
        {
            "target_sheet": "S",
            "ops": [
                {"op": "set_cell", "cell": "A1", "value": 5},
                {"op": "unknown_op", "x": 1},
                {"op": "set_formula", "cell": "B1", "formula": "=A1*2"},
            ],
        }
    )
    assert plan["target_sheet"] == "S"
    assert [o["op"] for o in plan["ops"]] == ["set_cell", "set_formula"]


def test_validate_edit_plan_empty() -> None:
    assert validate_edit_plan({"ops": []})


def test_validate_edit_plan_ok() -> None:
    plan = normalize_edit_plan({"ops": [{"op": "set_cell", "cell": "A1", "value": 1}]})
    assert validate_edit_plan(plan) == []
