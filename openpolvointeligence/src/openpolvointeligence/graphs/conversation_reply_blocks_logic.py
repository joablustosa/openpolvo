"""Parsing e normalização de blocos ricos para o chat."""

from __future__ import annotations

import json
import re
from typing import Any

_BLOCK_TYPES = frozenset(
    {
        "lead",
        "heading",
        "paragraph",
        "bullet_list",
        "numbered_list",
        "callout",
        "table",
        "key_points",
        "divider",
    },
)

_CALLOUT_VARIANTS = frozenset({"note", "tip", "warning", "success"})


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def parse_rich_blocks_json(raw: str) -> list[dict[str, Any]]:
    s = (raw or "").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = (
                "\n".join(lines[1:-1])
                if lines[-1].strip().startswith("```")
                else "\n".join(lines[1:])
            )
            s = inner.strip()
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        blocks = data
    elif isinstance(data, dict):
        blocks = data.get("blocks")
        if not isinstance(blocks, list):
            return []
    else:
        return []
    return normalize_rich_blocks(blocks)


def normalize_rich_blocks(blocks: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in blocks:
        if not isinstance(item, dict):
            continue
        btype = _norm(str(item.get("type") or "")).lower()
        if btype not in _BLOCK_TYPES:
            continue
        if btype == "heading":
            level = int(item.get("level") or 2)
            if level not in (2, 3):
                level = 2
            text = _norm(str(item.get("text") or ""))
            if text:
                out.append({"type": "heading", "level": level, "text": text})
            continue
        if btype in ("lead", "paragraph"):
            text = _norm(str(item.get("text") or ""))
            if text:
                out.append({"type": btype, "text": text})
            continue
        if btype in ("bullet_list", "numbered_list", "key_points"):
            items = item.get("items")
            if not isinstance(items, list):
                continue
            clean = [_norm(str(x)) for x in items if _norm(str(x))][:12]
            if not clean:
                continue
            block: dict[str, Any] = {"type": btype, "items": clean}
            title = _norm(str(item.get("title") or ""))
            if title and btype == "key_points":
                block["title"] = title
            out.append(block)
            continue
        if btype == "callout":
            variant = _norm(str(item.get("variant") or "note")).lower()
            if variant not in _CALLOUT_VARIANTS:
                variant = "note"
            title = _norm(str(item.get("title") or ""))
            text = _norm(str(item.get("text") or ""))
            if text:
                out.append(
                    {
                        "type": "callout",
                        "variant": variant,
                        "title": title or None,
                        "text": text,
                    },
                )
            continue
        if btype == "table":
            headers = item.get("headers")
            rows = item.get("rows")
            if not isinstance(headers, list) or not isinstance(rows, list):
                continue
            h = [_norm(str(x)) for x in headers if _norm(str(x))][:8]
            if not h:
                continue
            clean_rows: list[list[str]] = []
            for row in rows[:12]:
                if not isinstance(row, list):
                    continue
                clean_rows.append([_norm(str(c)) for c in row[: len(h)]])
            if clean_rows:
                out.append({"type": "table", "headers": h, "rows": clean_rows})
            continue
        if btype == "divider":
            out.append({"type": "divider"})
    return out[:24]


def blocks_to_plain_text(blocks: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for block in blocks:
        btype = str(block.get("type") or "")
        if btype == "lead":
            lines.append(str(block.get("text") or ""))
            lines.append("")
        elif btype == "heading":
            prefix = "##" if int(block.get("level") or 2) == 2 else "###"
            lines.append(f"{prefix} {block.get('text', '')}")
            lines.append("")
        elif btype == "paragraph":
            lines.append(str(block.get("text") or ""))
            lines.append("")
        elif btype in ("bullet_list", "key_points"):
            title = block.get("title")
            if title:
                lines.append(str(title))
            for item in block.get("items") or []:
                lines.append(f"- {item}")
            lines.append("")
        elif btype == "numbered_list":
            for i, item in enumerate(block.get("items") or [], start=1):
                lines.append(f"{i}. {item}")
            lines.append("")
        elif btype == "callout":
            title = block.get("title")
            if title:
                lines.append(f"{title}: {block.get('text', '')}")
            else:
                lines.append(str(block.get("text") or ""))
            lines.append("")
        elif btype == "table":
            headers = block.get("headers") or []
            lines.append(" | ".join(str(h) for h in headers))
            for row in block.get("rows") or []:
                lines.append(" | ".join(str(c) for c in row))
            lines.append("")
    return "\n".join(lines).strip()


def parse_enriched_brief_json(raw: str) -> dict[str, Any]:
    s = (raw or "").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = (
                "\n".join(lines[1:-1])
                if lines[-1].strip().startswith("```")
                else "\n".join(lines[1:])
            )
            s = inner.strip()
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return normalize_enriched_brief(data)


_INLINE_MD_RE = re.compile(
    r"\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_([^_]+)_|`([^`]+)`",
)


def _strip_inline_md(text: str) -> str:
    """Remove marcação inline comum para texto legível nos blocos."""
    out = text
    for _ in range(8):
        new = _INLINE_MD_RE.sub(lambda m: next(g for g in m.groups() if g), out)
        if new == out:
            break
        out = new
    return _norm(out)


def markdown_to_rich_blocks(text: str) -> list[dict[str, Any]]:
    """Converte markdown GFM simples em blocos ricos (zero-token, fallback universal)."""
    raw = (text or "").strip()
    if not raw:
        return []
    lines = raw.split("\n")
    blocks: list[dict[str, Any]] = []
    i = 0
    lead_set = False
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("### "):
            blocks.append({"type": "heading", "level": 3, "text": _strip_inline_md(stripped[4:])})
            i += 1
            continue
        if stripped.startswith("## "):
            blocks.append({"type": "heading", "level": 2, "text": _strip_inline_md(stripped[3:])})
            i += 1
            continue
        if stripped.startswith("# "):
            title = _strip_inline_md(stripped[2:])
            if not lead_set:
                blocks.append({"type": "lead", "text": title})
                lead_set = True
            else:
                blocks.append({"type": "heading", "level": 2, "text": title})
            i += 1
            continue
        if stripped.startswith(">"):
            quote_lines: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(
                {
                    "type": "callout",
                    "variant": "note",
                    "text": _strip_inline_md(" ".join(quote_lines)),
                },
            )
            continue
        if re.match(r"^[-*+]\s+", stripped):
            items: list[str] = []
            while i < len(lines):
                s = lines[i].strip()
                m = re.match(r"^[-*+]\s+(.*)$", s)
                if not m:
                    break
                items.append(_strip_inline_md(m.group(1)))
                i += 1
            if items:
                blocks.append({"type": "bullet_list", "items": items})
            continue
        if re.match(r"^\d+\.\s+", stripped):
            items = []
            while i < len(lines):
                s = lines[i].strip()
                m = re.match(r"^\d+\.\s+(.*)$", s)
                if not m:
                    break
                items.append(_strip_inline_md(m.group(1)))
                i += 1
            if items:
                blocks.append({"type": "numbered_list", "items": items})
            continue
        if stripped in ("---", "***", "___"):
            blocks.append({"type": "divider"})
            i += 1
            continue
        para_lines: list[str] = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if (
                not nxt
                or nxt.startswith("#")
                or nxt.startswith(">")
                or re.match(r"^[-*+]\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
                or nxt in ("---", "***", "___")
            ):
                break
            para_lines.append(nxt)
            i += 1
        para = _strip_inline_md(" ".join(para_lines))
        if para:
            if not lead_set and len(blocks) == 0:
                blocks.append({"type": "lead", "text": para})
                lead_set = True
            else:
                blocks.append({"type": "paragraph", "text": para})
    return normalize_rich_blocks(blocks)


def should_enrich_with_rich_blocks(meta: dict[str, Any]) -> bool:
    if meta.get("conversation_format") == "rich_blocks" and meta.get("rich_blocks"):
        return False
    if meta.get("document_kind") == "pdf_study_report":
        return False
    if meta.get("native_plugin"):
        return False
    routed = str(meta.get("routed_intent") or meta.get("intent") or "")
    if routed in ("polvo_code_builder", "estudo_pdf_profissional"):
        return False
    if meta.get("polvo_code_ops") or meta.get("polvo_code_ops_pending"):
        return False
    return True


def apply_rich_format_to_reply(text: str, meta: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Garante metadata rich_blocks para respostas gerais do Agente."""
    out_meta = dict(meta or {})
    if not should_enrich_with_rich_blocks(out_meta):
        return text, out_meta
    existing = out_meta.get("rich_blocks")
    if isinstance(existing, list) and existing:
        out_meta.setdefault("conversation_format", "rich_blocks")
        return text, out_meta
    blocks = markdown_to_rich_blocks(text)
    if not blocks:
        return text, out_meta
    out_meta["conversation_format"] = "rich_blocks"
    out_meta["rich_blocks"] = blocks
    out_meta.setdefault("rich_blocks_source", "markdown_fallback")
    plain = blocks_to_plain_text(blocks)
    return plain or text, out_meta


def normalize_enriched_brief(data: dict[str, Any], *, raw: str = "") -> dict[str, Any]:
    objective = _norm(str(data.get("objective") or raw or "Responder ao utilizador"))
    audience = _norm(str(data.get("audience") or "utilizador do Open Polvo"))
    tone = _norm(str(data.get("tone") or "profissional"))
    needs_research = bool(data.get("needs_research", True))
    queries = data.get("research_queries")
    if not isinstance(queries, list):
        queries = []
    clean_queries = [_norm(str(q)) for q in queries if _norm(str(q))][:5]
    full_prompt = _norm(str(data.get("full_prompt") or objective))
    return {
        "objective": objective,
        "audience": audience,
        "tone": tone,
        "needs_research": needs_research,
        "research_queries": clean_queries,
        "full_prompt": full_prompt[:5000],
    }
