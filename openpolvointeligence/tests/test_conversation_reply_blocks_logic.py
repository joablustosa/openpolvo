"""Testes dos blocos ricos de conversa."""

from __future__ import annotations

from openpolvointeligence.graphs.conversation_reply_blocks_logic import (
    blocks_to_plain_text,
    normalize_rich_blocks,
    parse_rich_blocks_json,
)


def test_parse_blocks_json() -> None:
    raw = '{"blocks":[{"type":"lead","text":"Olá"},{"type":"bullet_list","items":["a"]}]}'
    blocks = normalize_rich_blocks(parse_rich_blocks_json(raw))
    assert len(blocks) == 2
    assert blocks[0]["type"] == "lead"


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
