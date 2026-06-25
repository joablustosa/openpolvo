"""Roteamento determinístico para o workflow de resposta rica em conversa."""

from __future__ import annotations

_PDF_REQUEST_TERMS: tuple[str, ...] = (
    "pdf",
    "arquivo pdf",
    "em pdf",
    "retornar pdf",
    "gerar pdf",
    "exportar pdf",
    "documento pdf",
)

_STUDY_REQUEST_TERMS: tuple[str, ...] = (
    "estudo",
    "análise",
    "analise",
    "relatório",
    "relatorio",
    "diagnóstico",
    "diagnostico",
    "pesquisa",
    "levantamento",
)


def _wants_pdf_study_specialist(user_text: str) -> bool:
    txt = (user_text or "").strip().lower()
    if not txt:
        return False
    has_pdf = any(k in txt for k in _PDF_REQUEST_TERMS)
    has_study = any(k in txt for k in _STUDY_REQUEST_TERMS)
    return has_pdf and has_study

_SPECIFIC_FORMAT_TERMS: tuple[str, ...] = (
    "em pdf",
    "gerar pdf",
    "exportar pdf",
    "retornar pdf",
    "documento pdf",
    "em excel",
    "planilha excel",
    ".xlsx",
    ".csv",
    "exportar csv",
    "ficheiro csv",
    "arquivo csv",
    "formato json bruto",
    "só código",
    "apenas código",
)

_DESK_TOOL_TERMS: tuple[str, ...] = (
    "no workspace",
    "no projeto local",
    "abre o ficheiro",
    "abre o arquivo",
    "edita o ficheiro",
    "edita o arquivo",
    "corre no terminal",
    "executa no terminal",
    "npm run",
    "git ",
    "refatora o código",
    "corrige o código no",
    "usa a ferramenta",
    "tool call",
)

_DEV_BUILDER_TERMS: tuple[str, ...] = (
    "cria uma app",
    "criar app",
    "landing page",
    "dev studio",
    "webcontainer",
    "sandbox",
    "react + node",
    "fullstack",
)

_CONVERSATION_POSITIVE_TERMS: tuple[str, ...] = (
    "pesquisa",
    "pesquisar",
    "levantamento",
    "análise",
    "analise",
    "estudo",
    "relatório",
    "relatorio",
    "explica",
    "explique",
    "como funciona",
    "o que é",
    "compare",
    "comparar",
    "vantagens",
    "desvantagens",
    "resumo",
    "diagnóstico",
    "diagnostico",
    "recomenda",
    "melhor estratégia",
    "mercado",
    "tendência",
    "tendencia",
)


def wants_specific_deliverable_format(user_text: str) -> bool:
    txt = (user_text or "").strip().lower()
    if not txt:
        return False
    if _wants_pdf_study_specialist(txt):
        return True
    return any(term in txt for term in _SPECIFIC_FORMAT_TERMS)


def _looks_like_desk_tool_request(user_text: str) -> bool:
    txt = (user_text or "").strip().lower()
    return any(term in txt for term in _DESK_TOOL_TERMS)


def _looks_like_dev_builder_request(user_text: str) -> bool:
    txt = (user_text or "").strip().lower()
    return any(term in txt for term in _DEV_BUILDER_TERMS)


def should_use_conversation_workflow(user_text: str) -> bool:
    """Pedidos gerais/pesquisa sem formato de entrega específico → workflow rico."""
    txt = (user_text or "").strip()
    if len(txt) < 8:
        return False
    if wants_specific_deliverable_format(txt):
        return False
    if _looks_like_desk_tool_request(txt):
        return False
    if _looks_like_dev_builder_request(txt):
        return False
    low = txt.lower()
    if any(term in low for term in _CONVERSATION_POSITIVE_TERMS):
        return True
    # Perguntas abertas e pedidos explicativos comuns.
    if txt.endswith("?"):
        return True
    if low.startswith(("como ", "porque ", "porquê ", "qual ", "quais ", "quando ", "onde ")):
        return True
    # Pedidos descritivos mais longos beneficiam do workflow completo.
    return len(txt) >= 40
