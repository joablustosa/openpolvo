"""Roteamento determinístico (zero-token) para o agente unificado de planilhas.

Decide se um pedido deve ser atendido pelo ``xlsx_full`` e classifica a intenção
em ``read`` (Q&A sobre planilha anexada), ``edit`` (alterar a anexada) ou
``create`` (gerar uma nova planilha a partir de texto).
"""

from __future__ import annotations

from typing import Any

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_XLSX_MIME_LEGACY = "application/vnd.ms-excel"
_CSV_MIMES = ("text/csv", "application/csv")

# Termos que identificam o domínio "planilha/Excel".
_SHEET_TERMS: tuple[str, ...] = (
    "planilha",
    "planilhas",
    "folha de cálculo",
    "folha de calculo",
    "folha de excel",
    "excel",
    "xlsx",
    "spreadsheet",
    "csv",
    "tabela em excel",
)

# Verbos de criação/edição que, combinados com o domínio, acionam o builder.
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
    "constrói",
    "construir",
    "faz uma",
    "faça uma",
    "exporta",
    "exportar",
    "exporte",
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
    "preenche",
    "preencher",
    "calcula",
    "calcular",
    "acrescenta",
    "acrescentar",
)


def _is_xlsx_attachment(att: dict[str, Any]) -> bool:
    mime = str(att.get("mime_type") or "").strip().lower()
    name = str(att.get("name") or "").strip().lower()
    data = str(att.get("data_base64") or "").strip()
    if not data:
        return False
    if mime in (_XLSX_MIME, _XLSX_MIME_LEGACY) or mime in _CSV_MIMES:
        return True
    return name.endswith((".xlsx", ".xls", ".csv"))


def has_xlsx_attachment(attachments: list[dict[str, Any]] | None) -> bool:
    if not attachments:
        return False
    return any(_is_xlsx_attachment(a) for a in attachments if isinstance(a, dict))


def xlsx_attachments(attachments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not attachments:
        return []
    return [a for a in attachments if isinstance(a, dict) and _is_xlsx_attachment(a)]


def _has_sheet_domain(text: str) -> bool:
    return any(term in text for term in _SHEET_TERMS)


def wants_xlsx_creation(user_text: str) -> bool:
    """Pedido textual (sem anexo) para criar/gerar uma planilha Excel."""
    txt = (user_text or "").strip().lower()
    if not txt or not _has_sheet_domain(txt):
        return False
    return any(term in txt for term in _CREATE_TERMS)


def classify_xlsx_intent(user_text: str, has_attachment: bool) -> str:
    """read | edit | create — função pura testável."""
    txt = (user_text or "").strip().lower()
    if has_attachment:
        if any(term in txt for term in _EDIT_TERMS) or (
            any(term in txt for term in _CREATE_TERMS) and _has_sheet_domain(txt)
        ):
            return "edit"
        return "read"
    return "create"


def should_use_xlsx_workflow(
    user_text: str,
    attachments: list[dict[str, Any]] | None,
) -> bool:
    """Router curto: planilha anexada (ler/editar) ou pedido textual para criar."""
    if has_xlsx_attachment(attachments):
        return True
    return wants_xlsx_creation(user_text)
