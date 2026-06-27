"""Routing determinístico do agente unificado de documentos Word (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.documents_full.documents_full_routing import (
    classify_doc_intent,
    has_word_attachment,
    should_use_documents_workflow,
    wants_doc_creation,
    word_attachments,
)

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _docx(name: str = "relatorio.docx", mime: str = _DOCX_MIME, data: str = "Zm9v") -> dict:
    return {"name": name, "mime_type": mime, "data_base64": data}


def test_has_word_attachment_by_mime() -> None:
    assert has_word_attachment([_docx()]) is True


def test_has_word_attachment_doc_by_extension() -> None:
    assert has_word_attachment([_docx(name="legado.doc", mime="application/octet-stream")]) is True


def test_has_word_attachment_ignores_empty_data() -> None:
    assert has_word_attachment([_docx(data="")]) is False


def test_has_word_attachment_ignores_pdf() -> None:
    assert has_word_attachment([_docx(name="f.pdf", mime="application/pdf")]) is False


def test_word_attachments_filters() -> None:
    items = [_docx(), _docx(name="f.pdf", mime="application/pdf"), _docx(name="b.doc")]
    assert [a["name"] for a in word_attachments(items)] == ["relatorio.docx", "b.doc"]


def test_wants_doc_creation_true() -> None:
    assert wants_doc_creation("cria um documento word com proposta comercial") is True
    assert wants_doc_creation("redige um memorando em docx") is True


def test_wants_doc_creation_false_without_domain() -> None:
    assert wants_doc_creation("cria um relatório") is False


def test_classify_intent_read_with_attachment() -> None:
    assert classify_doc_intent("resume este documento", has_attachment=True) == "read"


def test_classify_intent_edit_with_attachment() -> None:
    assert classify_doc_intent("adiciona uma secção de conclusão", has_attachment=True) == "edit"


def test_classify_intent_create_without_attachment() -> None:
    assert classify_doc_intent("cria um documento word", has_attachment=False) == "create"


def test_should_use_documents_workflow_attachment() -> None:
    assert should_use_documents_workflow("qualquer coisa", [_docx()]) is True


def test_should_use_documents_workflow_text() -> None:
    assert should_use_documents_workflow("gera um documento word de contrato", []) is True


def test_should_use_documents_workflow_false() -> None:
    assert should_use_documents_workflow("escreve um poema", []) is False
