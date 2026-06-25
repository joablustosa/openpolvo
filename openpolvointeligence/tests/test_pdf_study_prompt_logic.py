"""Testes do prompt improver do agente PDF."""

from __future__ import annotations

from openpolvointeligence.graphs.pdf_study_prompt_logic import (
    normalize_enriched_brief,
    parse_enriched_brief_json,
)


def test_parse_enriched_brief_strips_fences() -> None:
    raw = """```json
{"objective": "Estudo X", "sections": ["A"], "full_prompt": "Brief"}
```"""
    data = parse_enriched_brief_json(raw)
    assert data["objective"] == "Estudo X"


def test_normalize_adds_default_sections() -> None:
    brief = normalize_enriched_brief({}, raw="Quero um estudo em PDF")
    assert brief["sections"]
    assert brief["sections"][-1] == "Revisão técnica"
    assert brief["full_prompt"]
