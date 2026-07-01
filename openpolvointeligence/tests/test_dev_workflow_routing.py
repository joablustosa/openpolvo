"""Testes de encaminhamento para o dev workflow."""

from openpolvointeligence.graphs.dev_workflow.dev_workflow_routing import (
    boost_analysis_for_dev_workflow,
    has_dev_studio_context,
    is_dev_studio_code_mode,
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


def test_is_dev_studio_code_mode():
    assert is_dev_studio_code_mode({"mode": "code", "project_id": "/w"})
    assert is_dev_studio_code_mode({"mode": "CODE"})
    assert not is_dev_studio_code_mode({"mode": "agent"})
    assert not is_dev_studio_code_mode({})
    assert not is_dev_studio_code_mode(None)


def test_dev_tab_code_mode_always_routes_to_dev_workflow():
    """Aba dev (mode='code'): heurísticas de texto não desviam do dev workflow."""
    for prompt in (
        "faz um estudo do código e um relatório dos problemas",
        "explica como funciona este projeto",
        "quero um sistema de estoque com relatórios de vendas e dashboard",
    ):
        assert should_use_dev_workflow(
            prompt,
            sandbox_project_id="/tmp/ws",
            dev_studio_context={"mode": "code", "project_id": "/tmp/ws"},
        )


def test_has_dev_studio_context():
    assert has_dev_studio_context(sandbox_project_id="/tmp/ws")
    assert has_dev_studio_context(project_files={"a.ts": ""})
    assert has_dev_studio_context(dev_studio_context={"mode": "code"})
    assert not has_dev_studio_context()
    assert not has_dev_studio_context(
        sandbox_project_id="", project_files={}, dev_studio_context=None
    )
