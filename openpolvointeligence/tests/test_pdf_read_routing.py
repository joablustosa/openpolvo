"""Routing determinístico do agente de leitura de PDF (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.pdf_read.pdf_read_routing import (
    has_pdf_attachment,
    pdf_attachments,
    should_use_pdf_read_workflow,
)


def _pdf(name: str = "doc.pdf", mime: str = "application/pdf", data: str = "Zm9v") -> dict:
    return {"name": name, "mime_type": mime, "data_base64": data}


def test_has_pdf_attachment_detects_by_mime() -> None:
    assert has_pdf_attachment([_pdf()]) is True


def test_has_pdf_attachment_detects_by_extension_when_mime_generic() -> None:
    assert has_pdf_attachment([_pdf(mime="application/octet-stream")]) is True


def test_has_pdf_attachment_ignores_empty_data() -> None:
    assert has_pdf_attachment([_pdf(data="")]) is False


def test_has_pdf_attachment_ignores_non_pdf() -> None:
    assert has_pdf_attachment([_pdf(name="img.png", mime="image/png")]) is False


def test_has_pdf_attachment_handles_none_and_empty() -> None:
    assert has_pdf_attachment(None) is False
    assert has_pdf_attachment([]) is False


def test_pdf_attachments_filters_only_pdfs() -> None:
    items = [_pdf(), _pdf(name="img.png", mime="image/png"), _pdf(name="b.pdf")]
    result = pdf_attachments(items)
    assert [a["name"] for a in result] == ["doc.pdf", "b.pdf"]


def test_should_use_pdf_read_workflow_priority_over_text() -> None:
    # Mesmo que o texto peça "gerar pdf", um PDF anexado encaminha para leitura.
    assert should_use_pdf_read_workflow("gerar pdf de estudo", [_pdf()]) is True


def test_should_use_pdf_read_workflow_false_without_attachment() -> None:
    assert should_use_pdf_read_workflow("resume este documento", []) is False
