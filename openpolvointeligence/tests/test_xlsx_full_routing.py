"""Routing determinístico do agente unificado de planilhas (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.xlsx_full.xlsx_full_routing import (
    classify_xlsx_intent,
    has_xlsx_attachment,
    should_use_xlsx_workflow,
    wants_xlsx_creation,
    xlsx_attachments,
)

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx(name: str = "dados.xlsx", mime: str = _XLSX_MIME, data: str = "Zm9v") -> dict:
    return {"name": name, "mime_type": mime, "data_base64": data}


def test_has_xlsx_attachment_by_mime() -> None:
    assert has_xlsx_attachment([_xlsx()]) is True


def test_has_xlsx_attachment_csv_by_extension() -> None:
    assert has_xlsx_attachment([_xlsx(name="t.csv", mime="application/octet-stream")]) is True


def test_has_xlsx_attachment_ignores_empty_data() -> None:
    assert has_xlsx_attachment([_xlsx(data="")]) is False


def test_has_xlsx_attachment_ignores_pdf() -> None:
    assert has_xlsx_attachment([_xlsx(name="d.pdf", mime="application/pdf")]) is False


def test_has_xlsx_attachment_handles_none() -> None:
    assert has_xlsx_attachment(None) is False
    assert has_xlsx_attachment([]) is False


def test_xlsx_attachments_filters() -> None:
    items = [
        _xlsx(),
        _xlsx(name="x.pdf", mime="application/pdf"),
        _xlsx(name="b.csv", mime="text/csv"),
    ]
    assert [a["name"] for a in xlsx_attachments(items)] == ["dados.xlsx", "b.csv"]


def test_wants_xlsx_creation_true() -> None:
    assert wants_xlsx_creation("cria uma planilha de orçamento mensal") is True
    assert wants_xlsx_creation("gera um excel com vendas por região") is True


def test_wants_xlsx_creation_false_without_domain() -> None:
    assert wants_xlsx_creation("cria um relatório de vendas") is False


def test_wants_xlsx_creation_false_without_verb() -> None:
    assert wants_xlsx_creation("o que é uma planilha?") is False


def test_classify_intent_create_without_attachment() -> None:
    assert classify_xlsx_intent("cria uma planilha", has_attachment=False) == "create"


def test_classify_intent_read_with_attachment_no_edit_verb() -> None:
    assert classify_xlsx_intent("resume esta planilha", has_attachment=True) == "read"


def test_classify_intent_edit_with_attachment() -> None:
    assert classify_xlsx_intent("adiciona uma coluna de total", has_attachment=True) == "edit"


def test_should_use_xlsx_workflow_attachment_priority() -> None:
    assert should_use_xlsx_workflow("qualquer pergunta", [_xlsx()]) is True


def test_should_use_xlsx_workflow_text_creation() -> None:
    assert should_use_xlsx_workflow("monta uma planilha de despesas", []) is True


def test_should_use_xlsx_workflow_false() -> None:
    assert should_use_xlsx_workflow("escreve um poema", []) is False
