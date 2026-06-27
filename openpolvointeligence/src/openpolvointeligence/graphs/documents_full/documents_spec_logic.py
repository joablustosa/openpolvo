"""Parse/normalize/validate determinístico das specs de documento Word (zero-token)."""

from __future__ import annotations

import json
import re
from typing import Any

_JSON_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)

_VALID_BLOCK_TYPES = {"heading", "paragraph", "bullet_list", "numbered_list", "table"}
_VALID_OPS = {
    "replace_text",
    "insert_paragraph",
    "insert_heading",
    "append_block",
    "delete_paragraph",
    "set_table_cell",
    "add_table_row",
    "insert_table",
}


def parse_json_block(raw: str) -> dict[str, Any]:
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


def _coerce_str_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    return [str(i).strip() for i in items if str(i).strip()]


def _normalize_block(raw: dict[str, Any]) -> dict[str, Any] | None:
    kind = str(raw.get("type") or "").strip()
    if kind not in _VALID_BLOCK_TYPES:
        return None
    block: dict[str, Any] = {"type": kind}
    if kind == "heading":
        block["level"] = max(1, min(3, int(raw.get("level") or 1)))
        block["text"] = str(raw.get("text") or "").strip()
        if not block["text"]:
            return None
    elif kind == "paragraph":
        block["text"] = str(raw.get("text") or "").strip()
        if not block["text"]:
            return None
        block["bold_phrases"] = _coerce_str_list(raw.get("bold_phrases"))
        block["italic_phrases"] = _coerce_str_list(raw.get("italic_phrases"))
    elif kind in ("bullet_list", "numbered_list"):
        items = _coerce_str_list(raw.get("items"))
        if not items:
            return None
        block["items"] = items
    elif kind == "table":
        headers = _coerce_str_list(raw.get("headers"))
        rows_in = raw.get("rows") or []
        rows: list[list[str]] = []
        for r in rows_in:
            if isinstance(r, list):
                rows.append([str(c) for c in r])
        if not headers and not rows:
            return None
        block["headers"] = headers
        block["rows"] = rows
    return block


def _normalize_page_setup(raw: dict[str, Any] | None) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float] = {}
    for key in ("margin_top_in", "margin_bottom_in", "margin_left_in", "margin_right_in"):
        val = raw.get(key)
        if val is not None:
            try:
                out[key] = float(val)
            except (TypeError, ValueError):
                continue
    return out


def normalize_document_spec(
    raw: dict[str, Any], *, default_name: str = "documento"
) -> dict[str, Any]:
    blocks_in = raw.get("blocks")
    if not isinstance(blocks_in, list):
        blocks_in = []
    blocks = [b for b in (_normalize_block(x) for x in blocks_in if isinstance(x, dict)) if b]
    filename = str(raw.get("filename") or default_name).strip() or default_name
    title = str(raw.get("title") or "").strip()
    return {
        "filename": filename,
        "title": title,
        "blocks": blocks,
        "page_setup": _normalize_page_setup(raw.get("page_setup")),
    }


def validate_document_spec(spec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not spec.get("blocks"):
        errors.append("Spec sem blocos: o LLM não devolveu conteúdo utilizável.")
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
        clean: dict[str, Any] = {"op": kind}
        for key in (
            "paragraph_index",
            "table_index",
            "row",
            "col",
            "level",
            "text",
            "find",
            "replace",
            "block",
        ):
            if key in op:
                clean[key] = op[key]
        if "value" in op:
            clean["value"] = op["value"]
        if "block" in op and isinstance(op["block"], dict):
            blk = _normalize_block(op["block"])
            if blk:
                clean["block"] = blk
        ops.append(clean)
    return {"ops": ops}


def validate_edit_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not plan.get("ops"):
        errors.append("Plano de edição sem operações válidas.")
    return errors
