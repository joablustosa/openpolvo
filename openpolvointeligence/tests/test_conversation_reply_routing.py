"""Testes de roteamento do workflow de conversa rica."""

from __future__ import annotations

from openpolvointeligence.graphs.conversation_reply_routing import should_use_conversation_workflow


def test_routes_research_without_specific_format() -> None:
    assert should_use_conversation_workflow(
        "Faça uma pesquisa sobre tendências de IA generativa em 2026"
    )


def test_skips_pdf_requests() -> None:
    assert not should_use_conversation_workflow("Faça um estudo de mercado e retorne em PDF")


def test_skips_desk_tool_requests() -> None:
    assert not should_use_conversation_workflow("Corre no terminal npm test no workspace")
