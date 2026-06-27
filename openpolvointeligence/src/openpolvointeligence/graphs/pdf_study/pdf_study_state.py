"""Estado tipado do grafo de estudo PDF profissional."""

from __future__ import annotations

from typing import Any, TypedDict


class PdfStudyState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str | None
    user_query: str
    conv_summary: str
    enriched_brief: dict[str, Any]
    research_dossier: str
    document_markdown: str
    reviewed_markdown: str
    pdf_bytes: bytes
    pdf_filename: str
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
