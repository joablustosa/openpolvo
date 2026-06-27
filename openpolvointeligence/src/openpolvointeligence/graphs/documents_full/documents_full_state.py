"""Estado tipado do grafo unificado de documentos Word (ler/interpretar/criar/editar)."""

from __future__ import annotations

from typing import Any, TypedDict


class DocumentsFullState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str | None
    user_query: str
    conv_summary: str
    attachments: list[dict[str, Any]]
    mode: str  # read | create | edit
    document_digest: dict[str, Any]
    document_spec: dict[str, Any]
    docx_bytes: bytes
    docx_filename: str
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
