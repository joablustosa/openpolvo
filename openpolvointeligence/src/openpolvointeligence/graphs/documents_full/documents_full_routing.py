"""Roteamento determinístico (zero-token) para o agente unificado de documentos Word."""

from __future__ import annotations

from typing import Any

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_DOC_MIME = "application/msword"

_DOC_TERMS: tuple[str, ...] = (
    "documento",
    "documentos",
    "word",
    "docx",
    "doc",
    "relatório word",
    "relatorio word",
    "carta",
    "memorando",
    "memorandum",
    "proposta",
    "documento word",
    "ficheiro word",
    "arquivo word",
)

_CREATE_TERMS: tuple[str, ...] = (
    "cria",
    "criar",
    "crie",
    "gera",
    "gerar",
    "gere",
    "monta",
    "montar",
    "monte",
    "redige",
    "redigir",
    "escreve",
    "escrever",
    "escreva",
    "constrói",
    "construir",
    "faz um",
    "faça um",
    "exporta",
    "exportar",
)

_EDIT_TERMS: tuple[str, ...] = (
    "edita",
    "editar",
    "edite",
    "altera",
    "alterar",
    "altere",
    "atualiza",
    "atualizar",
    "atualize",
    "modifica",
    "modificar",
    "modifique",
    "adiciona",
    "adicionar",
    "adicione",
    "remove",
    "remover",
    "remova",
    "corrige",
    "corrigir",
    "acrescenta",
    "acrescentar",
    "reformula",
    "reformular",
    "reorganiza",
    "reorganizar",
)


def _is_word_attachment(att: dict[str, Any]) -> bool:
    mime = str(att.get("mime_type") or "").strip().lower()
    name = str(att.get("name") or "").strip().lower()
    data = str(att.get("data_base64") or "").strip()
    if not data:
        return False
    if mime in (_DOCX_MIME, _DOC_MIME):
        return True
    return name.endswith((".docx", ".doc"))


def has_word_attachment(attachments: list[dict[str, Any]] | None) -> bool:
    if not attachments:
        return False
    return any(_is_word_attachment(a) for a in attachments if isinstance(a, dict))


def word_attachments(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not attachments:
        return []
    return [a for a in attachments if isinstance(a, dict) and _is_word_attachment(a)]


def _has_doc_domain(text: str) -> bool:
    return any(term in text for term in _DOC_TERMS)


def wants_doc_creation(user_text: str) -> bool:
    txt = (user_text or "").strip().lower()
    if not txt or not _has_doc_domain(txt):
        return False
    return any(term in txt for term in _CREATE_TERMS)


def classify_doc_intent(user_text: str, has_attachment: bool) -> str:
    txt = (user_text or "").strip().lower()
    if has_attachment:
        if any(term in txt for term in _EDIT_TERMS) or (
            any(term in txt for term in _CREATE_TERMS) and _has_doc_domain(txt)
        ):
            return "edit"
        return "read"
    return "create"


def should_use_documents_workflow(
    user_text: str,
    attachments: list[dict[str, Any]] | None,
) -> bool:
    if has_word_attachment(attachments):
        return True
    return wants_doc_creation(user_text)
