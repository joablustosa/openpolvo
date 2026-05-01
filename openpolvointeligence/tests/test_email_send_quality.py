"""Testes heurísticos de qualidade do corpo de e-mail."""

from openpolvointeligence.graphs.email_send_quality import (
    apply_email_quality_gate,
    email_body_looks_raw_or_incomplete,
)


def test_detects_serp_style_heading() -> None:
    body = "Claro!\n\nResultados Google:\n1) Trending\nhttps://www.nytimes.com/trending/"
    assert email_body_looks_raw_or_incomplete(body) is True


def test_detects_short_body() -> None:
    assert email_body_looks_raw_or_incomplete("oi") is True


def test_accepts_newsletter_style() -> None:
    body = (
        "Resumo do dia\n\n"
        "• Tema A: contexto breve com mais de oitenta caracteres no total do documento.\n"
        "• Tema B: outro parágrafo com substância editorial.\n\n"
        "Em detalhe\n\n"
        "Primeiro parágrafo com análise própria sobre notícias internacionais e contexto.\n\n"
        "Segundo parágrafo com mais desenvolvimento e tom profissional adequado a newsletter.\n\n"
        "Terceiro parágrafo a fechar temas com referência genérica às fontes sem listar só URLs.\n\n"
        "Com os melhores cumprimentos"
    )
    assert email_body_looks_raw_or_incomplete(body) is False


def test_apply_gate_clears_pending() -> None:
    meta = {
        "email_send_pending": True,
        "email_send_draft": {"body": "Resultados Google:\nhttps://a.com", "subject": "x"},
    }
    apply_email_quality_gate(meta)
    assert meta["email_send_pending"] is False
    assert meta["email_send_blocked"] is True
    assert "email_send_quality_note" in meta
