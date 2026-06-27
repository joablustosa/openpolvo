"""Parse/normalize/validate determinístico das specs de planilha (zero-token).

``WorkbookSpec`` descreve uma planilha a criar; ``EditPlan`` descreve operações a
aplicar numa planilha existente. Toda a validação é pura e testável — o LLM apenas
preenche o JSON, e estas funções garantem que o builder recebe dados coerentes.
"""

from __future__ import annotations

import json
import re
from typing import Any

_JSON_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)

_VALID_OPS = {"set_cell", "set_formula", "add_column", "add_rows", "delete_row", "rename_sheet"}


def parse_json_block(raw: str) -> dict[str, Any]:
    """Extrai o primeiro objeto JSON de uma resposta do LLM (tolerante a cercas)."""
    text = (raw or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = _JSON_RE.search(text)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return data if isinstance(data, dict) else {}


def _coerce_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _normalize_sheet(raw: dict[str, Any], index: int) -> dict[str, Any]:
    name = str(raw.get("name") or f"Folha{index + 1}").strip()[:31] or f"Folha{index + 1}"
    columns = [str(c).strip() for c in (raw.get("columns") or []) if str(c).strip()]
    rows_in = raw.get("rows") or []
    rows: list[list[Any]] = []
    for r in rows_in:
        if isinstance(r, list):
            rows.append([_coerce_cell(c) for c in r])
        elif isinstance(r, dict) and columns:
            rows.append([_coerce_cell(r.get(col)) for col in columns])
    number_formats = {
        str(k).strip().upper(): str(v)
        for k, v in (raw.get("number_formats") or {}).items()
        if str(k).strip()
    }
    column_widths = {
        str(k).strip().upper(): float(v)
        for k, v in (raw.get("column_widths") or {}).items()
        if str(k).strip() and _is_number(v)
    }
    return {
        "name": name,
        "columns": columns,
        "rows": rows,
        "number_formats": number_formats,
        "column_widths": column_widths,
        "freeze_header": bool(raw.get("freeze_header", True)),
    }


def _is_number(v: Any) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def normalize_workbook_spec(
    raw: dict[str, Any], *, default_name: str = "planilha"
) -> dict[str, Any]:
    sheets_in = raw.get("sheets")
    if not isinstance(sheets_in, list) or not sheets_in:
        # Permite spec de folha única achatada.
        if raw.get("columns") or raw.get("rows"):
            sheets_in = [raw]
        else:
            sheets_in = []
    sheets = [_normalize_sheet(s, i) for i, s in enumerate(sheets_in) if isinstance(s, dict)]
    filename = str(raw.get("filename") or default_name).strip() or default_name
    title = str(raw.get("title") or "").strip()
    return {"filename": filename, "title": title, "sheets": sheets}


def validate_workbook_spec(spec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    sheets = spec.get("sheets") or []
    if not sheets:
        errors.append("Spec sem folhas: o LLM não devolveu colunas/linhas utilizáveis.")
    seen: set[str] = set()
    for s in sheets:
        name = s.get("name", "")
        if name in seen:
            errors.append(f"Nome de folha duplicado: {name}")
        seen.add(name)
        if not s.get("columns") and not s.get("rows"):
            errors.append(f"Folha '{name}' vazia (sem colunas nem linhas).")
    return errors


def normalize_edit_plan(raw: dict[str, Any]) -> dict[str, Any]:
    ops_in = raw.get("ops") or []
    ops: list[dict[str, Any]] = []
    for op in ops_in:
        if not isinstance(op, dict):
            continue
        kind = str(op.get("op") or "").strip()
        if kind not in _VALID_OPS:
            continue
        clean = {"op": kind}
        for key in ("sheet", "cell", "formula", "header", "row", "to"):
            if key in op:
                clean[key] = op[key]
        if "value" in op:
            clean["value"] = _coerce_cell(op["value"])
        if "values" in op and isinstance(op["values"], list):
            clean["values"] = [_coerce_cell(v) for v in op["values"]]
        if "rows" in op and isinstance(op["rows"], list):
            clean["rows"] = [
                [_coerce_cell(c) for c in r] if isinstance(r, list) else [_coerce_cell(r)]
                for r in op["rows"]
            ]
        ops.append(clean)
    return {"target_sheet": str(raw.get("target_sheet") or "").strip(), "ops": ops}


def validate_edit_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not plan.get("ops"):
        errors.append("Plano de edição sem operações válidas.")
    return errors
