"""Testes de encaminhamento para o dev workflow."""

from openpolvointeligence.graphs.dev_workflow.dev_workflow_routing import (
    boost_analysis_for_dev_workflow,
    should_use_dev_workflow,
)


def test_should_use_dev_workflow_modify_with_project():
    assert should_use_dev_workflow(
        "Corrige a cor do botão no Hero",
        sandbox_project_id="/tmp/proj",
    )


def test_should_use_dev_workflow_create_without_project():
    assert should_use_dev_workflow("Cria uma landing page para cafeteria")


def test_should_use_dev_workflow_for_web_system_keywords():
    assert should_use_dev_workflow("Cria uma página web fullstack para reservas")


def test_should_not_route_app_support_to_dev():
    assert not should_use_dev_workflow(
        "A app Open Polvo não abre no login",
        sandbox_project_id="/tmp/proj",
    )


def test_boost_analysis_forces_polvo_code_builder():
    analysis = {"intent": "duvida_tecnica_tutorial", "confidence": 0.7, "reasoning": "x"}
    out = boost_analysis_for_dev_workflow(
        analysis,
        user_prompt="Altera o título da landing",
        sandbox_project_id="/data/site",
    )
    assert out["intent"] == "polvo_code_builder"
    assert float(out["confidence"]) >= 0.88
