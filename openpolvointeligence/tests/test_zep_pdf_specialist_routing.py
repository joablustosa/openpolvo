from __future__ import annotations

from openpolvointeligence.graphs.orchestrator.zepolvinho_graph import (
    route_intent,
    wants_pdf_study_specialist,
)


def test_detects_pdf_study_request() -> None:
    assert wants_pdf_study_specialist(
        "Faça um estudo de mercado sobre IA para saúde e me retorne em PDF"
    )


def test_ignores_non_pdf_requests() -> None:
    assert not wants_pdf_study_specialist("Cria uma landing page com React e backend Node")
    assert not wants_pdf_study_specialist("Quero um estudo competitivo, mas em texto no chat")


def test_routes_pdf_study_intent_when_confident() -> None:
    assert route_intent("estudo_pdf_profissional", 0.95) == "estudo_pdf_profissional"
