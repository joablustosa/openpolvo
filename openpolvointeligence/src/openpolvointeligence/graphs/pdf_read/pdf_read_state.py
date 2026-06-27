"""Estado tipado do grafo de leitura/extração de PDFs anexados."""

from __future__ import annotations

from typing import Any, TypedDict


class PdfReadState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str | None
    user_query: str
    conv_summary: str
    attachments: list[dict[str, Any]]
    pages: list[dict[str, Any]]
    tables: list[dict[str, Any]]
    images: list[dict[str, Any]]
    ocr_notes: list[str]
    document_markdown: str
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
