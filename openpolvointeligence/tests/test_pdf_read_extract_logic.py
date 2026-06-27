"""Lógica determinística de extração de PDF (decode + tabelas → markdown)."""

from __future__ import annotations

import base64
import importlib.util

import pytest

from openpolvointeligence.graphs.pdf_read.pdf_read_extract_logic import (
    _tables_to_markdown,
    decode_attachment,
    extract_pdf_content,
)

_HAS_FITZ = importlib.util.find_spec("fitz") is not None


def test_decode_attachment_plain_base64() -> None:
    data = base64.b64encode(b"hello").decode()
    assert decode_attachment({"data_base64": data}) == b"hello"


def test_decode_attachment_data_url_prefix() -> None:
    data = "data:application/pdf;base64," + base64.b64encode(b"pdf").decode()
    assert decode_attachment({"data_base64": data}) == b"pdf"


def test_decode_attachment_empty_returns_none() -> None:
    assert decode_attachment({"data_base64": ""}) is None
    assert decode_attachment({}) is None


def test_tables_to_markdown_builds_header_and_rows() -> None:
    md = _tables_to_markdown([["A", "B"], ["1", "2"], ["3", "4"]])
    lines = md.splitlines()
    assert lines[0] == "| A | B |"
    assert lines[1] == "| --- | --- |"
    assert "| 1 | 2 |" in lines
    assert "| 3 | 4 |" in lines


def test_tables_to_markdown_skips_empty_rows() -> None:
    md = _tables_to_markdown([["A", "B"], [None, None], ["x", "y"]])
    assert "| x | y |" in md
    assert md.count("\n") == 2  # header + separador + 1 linha de dados


def test_extract_pdf_content_degrades_without_pymupdf() -> None:
    if _HAS_FITZ:
        pytest.skip("PyMuPDF instalado — sem caminho de degradação a testar")
    out = extract_pdf_content(b"%PDF-1.4 fake")
    assert out["extractor"] == "none"
    assert out["error"]
    assert out["pages"] == []


@pytest.mark.skipif(not _HAS_FITZ, reason="requer PyMuPDF instalado")
def test_extract_pdf_content_reads_text() -> None:
    import fitz  # type: ignore[import-untyped]

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Conteudo de teste")
    pdf_bytes = doc.tobytes()
    doc.close()

    out = extract_pdf_content(pdf_bytes, filename="t.pdf")
    assert out["extractor"] == "pymupdf"
    assert out["page_count"] == 1
    assert "Conteudo de teste" in out["pages"][0]["text"]
