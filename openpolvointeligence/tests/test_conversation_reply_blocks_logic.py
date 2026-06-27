"""Testes dos blocos ricos de conversa."""

from __future__ import annotations

from openpolvointeligence.graphs.conversation.conversation_reply_blocks_logic import (
    apply_rich_format_to_reply,
    blocks_to_plain_text,
    markdown_to_rich_blocks,
    normalize_rich_blocks,
    parse_rich_blocks_json,
)


def test_parse_blocks_json() -> None:
    raw = '{"blocks":[{"type":"lead","text":"Olá"},{"type":"bullet_list","items":["a"]}]}'
    blocks = normalize_rich_blocks(parse_rich_blocks_json(raw))
    assert len(blocks) == 2
    assert blocks[0]["type"] == "lead"


def test_markdown_to_rich_blocks() -> None:
    md = "# Título\n\n## Secção\n\n- item um\n- item dois\n\nParágrafo final."
    blocks = markdown_to_rich_blocks(md)
    assert any(b["type"] == "lead" for b in blocks)
    assert any(b["type"] == "heading" for b in blocks)
    assert any(b["type"] == "bullet_list" for b in blocks)


def test_apply_rich_format_to_reply() -> None:
    text = "## Olá\n\n- a\n- b"
    _, meta = apply_rich_format_to_reply(text, {"intent": "desk_agent"})
    assert meta.get("conversation_format") == "rich_blocks"
    assert meta.get("rich_blocks")


def test_blocks_to_plain_text() -> None:
    blocks = normalize_rich_blocks(
        [
            {"type": "lead", "text": "Resumo"},
            {"type": "heading", "level": 2, "text": "Título"},
        ],
    )
    text = blocks_to_plain_text(blocks)
    assert "Resumo" in text
    assert "Título" in text
