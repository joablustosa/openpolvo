"""OCR de páginas escaneadas: renderiza a página a PNG e aplica Tesseract.

Degrada graciosamente: sem PyMuPDF/Pillow/pytesseract ou sem o binário Tesseract
instalado, devolve uma nota explicando o documento como escaneado em vez de falhar.
"""

from __future__ import annotations

import logging
from typing import Any

_logger = logging.getLogger(__name__)

# Resolução do render para OCR (zoom 2x ≈ 144 DPI) — equilíbrio nitidez/tamanho.
_OCR_ZOOM = 2.0
# Limite de páginas a passar por OCR num único pedido (custo/tempo).
_MAX_OCR_PAGES = 12


def tesseract_available() -> bool:
    try:
        import pytesseract  # type: ignore[import-untyped]
    except ImportError:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001 — binário ausente/erro de ambiente
        return False


def ocr_scanned_pages(
    pdf_bytes: bytes,
    pages: list[dict[str, Any]],
) -> tuple[dict[int, str], list[str]]:
    """Aplica OCR às páginas marcadas ``needs_ocr``.

    Devolve ``({page_no: texto_ocr}, notas)``. ``notas`` documenta o estado
    (sucesso, ferramenta ausente) para o utilizador final.
    """
    targets = [int(p["page"]) for p in pages if p.get("needs_ocr")]
    if not targets:
        return {}, []

    if not tesseract_available():
        return {}, [
            "Páginas sem texto nativo detetadas (documento possivelmente escaneado), "
            "mas o OCR (Tesseract) não está disponível no servidor. Instale o Tesseract "
            "para extrair o texto destas páginas."
        ]

    try:
        import io

        import fitz  # type: ignore[import-untyped]
        import pytesseract  # type: ignore[import-untyped]
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError as exc:
        return {}, [f"OCR indisponível (dependência ausente: {exc})."]

    results: dict[int, str] = {}
    notes: list[str] = []
    matrix = fitz.Matrix(_OCR_ZOOM, _OCR_ZOOM)
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for page_no in targets[:_MAX_OCR_PAGES]:
                try:
                    page = doc[page_no - 1]
                    pix = page.get_pixmap(matrix=matrix)
                    img = Image.open(io.BytesIO(pix.tobytes("png")))
                    text = (pytesseract.image_to_string(img, lang="por+eng") or "").strip()
                    if text:
                        results[page_no] = text
                except Exception as exc:  # noqa: BLE001
                    _logger.warning("OCR failed on page %s: %s", page_no, exc)
    except Exception as exc:  # noqa: BLE001
        return {}, [f"OCR interrompido: {str(exc)[:160]}"]

    if results:
        notes.append(f"OCR aplicado a {len(results)} página(s) escaneada(s) via Tesseract.")
    if len(targets) > _MAX_OCR_PAGES:
        notes.append(
            f"Apenas as primeiras {_MAX_OCR_PAGES} páginas escaneadas foram processadas por OCR."
        )
    return results, notes
