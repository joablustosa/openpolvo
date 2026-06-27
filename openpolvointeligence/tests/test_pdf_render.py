"""Testes de renderização Markdown → PDF."""

from __future__ import annotations

from openpolvointeligence.graphs.pdf_study.pdf_render import (
    build_pdf_metadata,
    markdown_to_html,
    render_pdf_bytes,
    slugify_filename,
)


def test_slugify_filename() -> None:
    assert slugify_filename("Estudo de Mercado 2026").endswith(".pdf")
    assert " " not in slugify_filename("  ")


def test_markdown_to_html_includes_title() -> None:
    html = markdown_to_html("# Título\n\nParágrafo.", title="Título")
    assert "<h1>" in html
    assert "Título" in html


def test_render_pdf_bytes_produces_pdf_header() -> None:
    md = "# Relatório\n\n## Resumo\n\nConteúdo de teste com **negrito**."
    pdf = render_pdf_bytes(md, title="Relatório")
    assert pdf[:4] == b"%PDF"
    meta = build_pdf_metadata(pdf, filename="relatorio.pdf", markdown_text=md)
    assert meta["document_kind"] == "pdf_study_report"
    assert meta.get("pdf_document_base64")
