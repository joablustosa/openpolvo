"""Extração determinística (zero-token) de PDFs: texto, tabelas e imagens.

PyMuPDF (``fitz``) extrai texto nativo e inventário de imagens por página;
``pdfplumber`` deteta tabelas e converte-as para Markdown. Ambas as bibliotecas
degradam graciosamente: se não estiverem instaladas, a extração devolve um aviso
em vez de falhar.
"""

from __future__ import annotations

import base64
import binascii
import logging
from typing import Any

_logger = logging.getLogger(__name__)

# Páginas com menos texto nativo que isto são candidatas a OCR (documento escaneado).
OCR_TEXT_THRESHOLD = 24


def decode_attachment(att: dict[str, Any]) -> bytes | None:
    """Descodifica o ``data_base64`` de um anexo para bytes (tolerante a data URLs)."""
    raw = str(att.get("data_base64") or "").strip()
    if not raw:
        return None
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        return None


def _tables_to_markdown(rows: list[list[Any]]) -> str:
    cleaned = [
        [("" if cell is None else str(cell).replace("\n", " ").strip()) for cell in row]
        for row in rows
        if any(cell is not None and str(cell).strip() for cell in row)
    ]
    if not cleaned:
        return ""
    width = max(len(r) for r in cleaned)
    cleaned = [r + [""] * (width - len(r)) for r in cleaned]
    header = cleaned[0]
    body = cleaned[1:] if len(cleaned) > 1 else []
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * width) + " |"]
    for r in body:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def _extract_tables(pdf_bytes: bytes) -> list[dict[str, Any]]:
    try:
        import pdfplumber  # type: ignore[import-untyped]
    except ImportError:
        return []
    out: list[dict[str, Any]] = []
    try:
        import io

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page_no, page in enumerate(pdf.pages, start=1):
                try:
                    raw_tables = page.extract_tables() or []
                except Exception:  # noqa: BLE001 — página corrompida não derruba o resto
                    continue
                for idx, rows in enumerate(raw_tables):
                    md = _tables_to_markdown(rows)
                    if not md:
                        continue
                    out.append(
                        {
                            "page": page_no,
                            "index": idx,
                            "markdown": md,
                            "rows": len(rows),
                            "cols": max((len(r) for r in rows), default=0),
                        }
                    )
    except Exception as exc:  # noqa: BLE001
        _logger.warning("pdfplumber table extraction failed: %s", exc)
    return out


def extract_pdf_content(pdf_bytes: bytes, *, filename: str = "documento.pdf") -> dict[str, Any]:
    """Extrai páginas (texto), inventário de imagens e metadados via PyMuPDF.

    Devolve ``{pages, images, page_count, title, extractor, error}``. As tabelas
    são adicionadas por :func:`extract_pdf_content_full`.
    """
    try:
        import fitz  # type: ignore[import-untyped]  # PyMuPDF
    except ImportError:
        return {
            "pages": [],
            "images": [],
            "page_count": 0,
            "title": "",
            "extractor": "none",
            "error": "PyMuPDF não instalado — instale o grupo opcional `pdf`.",
        }

    pages: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    title = ""
    page_count = 0
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            title = str((doc.metadata or {}).get("title") or "").strip()
            page_count = doc.page_count
            for page_no, page in enumerate(doc, start=1):
                text = (page.get_text("text") or "").strip()
                pages.append(
                    {
                        "page": page_no,
                        "text": text,
                        "char_count": len(text),
                        "needs_ocr": len(text) < OCR_TEXT_THRESHOLD,
                    }
                )
                for img_idx, _img in enumerate(page.get_images(full=True)):
                    images.append({"page": page_no, "index": img_idx})
    except Exception as exc:  # noqa: BLE001
        return {
            "pages": pages,
            "images": images,
            "page_count": page_count,
            "title": title,
            "extractor": "pymupdf",
            "error": f"Falha ao abrir o PDF: {str(exc)[:200]}",
        }

    return {
        "pages": pages,
        "images": images,
        "page_count": page_count,
        "title": title or filename,
        "extractor": "pymupdf",
        "error": "",
    }


def extract_pdf_content_full(pdf_bytes: bytes, *, filename: str = "documento.pdf") -> dict[str, Any]:
    """Extração completa: texto + imagens (PyMuPDF) e tabelas (pdfplumber)."""
    content = extract_pdf_content(pdf_bytes, filename=filename)
    content["tables"] = _extract_tables(pdf_bytes) if not content.get("error") else []
    return content
