"""Estado tipado do grafo unificado de planilhas (ler/interpretar/criar/editar)."""

from __future__ import annotations

from typing import Any, TypedDict


class XlsxFullState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str | None
    user_query: str
    conv_summary: str
    attachments: list[dict[str, Any]]
    mode: str  # read | create | edit
    workbook_digest: dict[str, Any]
    workbook_spec: dict[str, Any]
    xlsx_bytes: bytes
    xlsx_filename: str
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
