"""Testes dos subgrafos DevAgent (estrutura e factory)."""

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.workflows.graph_factory import (
    WORKFLOW_STEPS,
    build_workflow_graph,
    reset_workflow_graph_cache,
)
from openpolvointeligence.graphs.dev_workflow.workflows import new_app_workflow


def test_new_app_workflow_steps():
    assert new_app_workflow.WORKFLOW_ID == "new_app"
    assert "context_loader" in new_app_workflow.STEPS
    assert "requirements" in new_app_workflow.STEPS
    assert "legacy_core" in new_app_workflow.STEPS
    assert "type_check" in new_app_workflow.STEPS
    assert "workspace_opener" in new_app_workflow.STEPS
    assert WORKFLOW_STEPS["new_app"] == list(new_app_workflow.STEPS)


def test_build_workflow_graph_compiles():
    reset_workflow_graph_cache()
    settings = Settings()
    graph = build_workflow_graph(settings, "new_app")
    assert graph is not None
    node_names = set(getattr(graph, "nodes", {}).keys())
    assert "step_requirements" in node_names
    assert "deliver" in node_names
    assert "review_gate" in node_names


def test_delete_workflow_has_pause_node():
    reset_workflow_graph_cache()
    settings = Settings()
    graph = build_workflow_graph(settings, "delete")
    node_names = set(getattr(graph, "nodes", {}).keys())
    assert "pause_check" in node_names
    assert "step_delete" in node_names
