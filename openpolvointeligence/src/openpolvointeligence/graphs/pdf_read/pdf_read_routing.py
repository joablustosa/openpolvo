"""Roteamento determinístico (zero-token) para o especialista de leitura de PDF.

Prioridade absoluta sobre keywords de "pdf" no texto: se há um PDF anexado, o
pedido é de **leitura** (`pdf_read`), nunca de **geração** (`pdf_study`).
"""

from __future__ import annotations

from typing import Any

_PDF_MIME = "application/pdf"


def _is_pdf_attachment(att: dict[str, Any]) -> bool:
    mime = str(att.get("mime_type") or "").strip().lower()
    name = str(att.get("name") or "").strip().lower()
    data = str(att.get("data_base64") or "").strip()
    if not data:
        return False
    return mime == _PDF_MIME or name.endswith(".pdf")


def has_pdf_attachment(attachments: list[dict[str, Any]] | None) -> bool:
    if not attachments:
        return False
    return any(_is_pdf_attachment(a) for a in attachments if isinstance(a, dict))


def pdf_attachments(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not attachments:
        return []
    return [a for a in attachments if isinstance(a, dict) and _is_pdf_attachment(a)]


def should_use_pdf_read_workflow(
    _user_text: str,
    attachments: list[dict[str, Any]] | None,
) -> bool:
    """Router curto: qualquer PDF anexado encaminha para o agente de leitura."""
    return has_pdf_attachment(attachments)
