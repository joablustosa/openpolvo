"""Leitura determinística (zero-token) de documentos Word anexados (.docx/.doc).

Produz um digest compacto (markdown estruturado + estatísticas) para o LLM.
Degrada graciosamente se mammoth/python-docx não estiverem instalados.
Para `.doc` legado tenta antiword/catdoc via subprocess se disponíveis no PATH.
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

_logger = logging.getLogger(__name__)

_MAX_MD_CHARS = 12_000


def decode_attachment(att: dict[str, Any]) -> bytes | None:
    raw = str(att.get("data_base64") or "").strip()
    if not raw:
        return None
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        return None


def _is_doc_legacy(filename: str, mime: str) -> bool:
    return filename.lower().endswith(".doc") or mime.lower() == "application/msword"


def _count_stats(markdown: str) -> dict[str, int]:
    headings = len(re.findall(r"^#{1,6}\s", markdown, re.MULTILINE))
    paragraphs = len(
        [ln for ln in markdown.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    )
    tables = markdown.count("| --- |") + markdown.count("|---|")
    return {
        "headings": headings,
        "paragraphs": max(paragraphs, 1 if markdown.strip() else 0),
        "tables": tables,
    }


def _extract_doc_legacy(data: bytes, filename: str) -> tuple[str, str]:
    """Best-effort para .doc via antiword ou catdoc (subprocess, zero dep pip)."""
    for tool in ("antiword", "catdoc"):
        if not shutil.which(tool):
            continue
        try:
            with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            try:
                result = subprocess.run(
                    [tool, tmp_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                text = (result.stdout or "").strip()
                if text:
                    return text, tool
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001
            _logger.debug("%s failed for %s: %s", tool, filename, exc)
    return "", ""


def _read_docx_digest(data: bytes, filename: str) -> dict[str, Any]:
    markdown = ""
    extractor = "none"
    error = ""
    try:
        import mammoth  # type: ignore[import-untyped]

        result = mammoth.convert_to_markdown(io.BytesIO(data))
        markdown = (result.value or "").strip()
        extractor = "mammoth"
        if result.messages:
            warns = [str(m) for m in result.messages[:3]]
            if warns:
                error = "; ".join(warns)[:200]
    except ImportError:
        error = "mammoth não instalado — instale a dependência para ler .docx."
    except Exception as exc:  # noqa: BLE001
        error = f"Falha mammoth: {str(exc)[:200]}"

    if not markdown:
        try:
            from docx import Document  # type: ignore[import-untyped]

            doc = Document(io.BytesIO(data))
            parts = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            markdown = "\n\n".join(parts)
            extractor = "python-docx" if extractor == "none" else extractor
        except ImportError:
            if not error:
                error = "python-docx não instalado."
        except Exception as exc:  # noqa: BLE001
            if not error:
                error = f"Falha python-docx: {str(exc)[:200]}"

    stats = _count_stats(markdown)
    return {
        "filename": filename,
        "kind": "docx",
        "markdown": _clip(markdown, _MAX_MD_CHARS),
        "headings": stats["headings"],
        "paragraphs": stats["paragraphs"],
        "tables": stats["tables"],
        "extractor": extractor,
        "error": error,
    }


def _read_doc_digest(data: bytes, filename: str) -> dict[str, Any]:
    text, tool = _extract_doc_legacy(data, filename)
    if not text:
        return {
            "filename": filename,
            "kind": "doc",
            "markdown": "",
            "headings": 0,
            "paragraphs": 0,
            "tables": 0,
            "extractor": "none",
            "error": (
                "Não foi possível extrair texto do .doc legado. "
                "Converta para .docx ou instale antiword/catdoc no PATH."
            ),
        }
    markdown = f"# Documento: {filename}\n\n{text}"
    stats = _count_stats(markdown)
    return {
        "filename": filename,
        "kind": "doc",
        "markdown": _clip(markdown, _MAX_MD_CHARS),
        "headings": stats["headings"],
        "paragraphs": stats["paragraphs"],
        "tables": stats["tables"],
        "extractor": tool,
        "error": "",
    }


def _clip(s: str, max_len: int) -> str:
    t = (s or "").strip()
    return t if len(t) <= max_len else t[: max_len - 1] + "…"


def read_document_digest(data: bytes, *, filename: str, mime_type: str = "") -> dict[str, Any]:
    if _is_doc_legacy(filename, mime_type):
        return _read_doc_digest(data, filename)
    return _read_docx_digest(data, filename)


def digest_to_markdown(digest: dict[str, Any]) -> str:
    parts = [f"# Documento: {digest.get('filename')} ({digest.get('kind')})"]
    if digest.get("error"):
        parts.append(f"> Aviso: {digest['error']}")
    parts.append(
        f"Estatísticas: {digest.get('headings', 0)} secções, "
        f"{digest.get('paragraphs', 0)} parágrafos, {digest.get('tables', 0)} tabelas "
        f"(extractor: {digest.get('extractor') or 'n/a'})"
    )
    md = digest.get("markdown") or ""
    if md:
        parts.append(md)
    else:
        parts.append("_(sem conteúdo extraível)_")
    return "\n\n".join(parts).strip()
