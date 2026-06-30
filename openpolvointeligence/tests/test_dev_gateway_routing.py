"""Testes de roteamento do gateway DevAgent (zero-token)."""

from openpolvointeligence.graphs.dev_workflow.core.dev_gateway_graph import route_after_classify
from openpolvointeligence.graphs.dev_workflow.core.workflow_dispatch import (
    workflow_id_for_kind,
)


def test_route_after_classify_explain():
    assert route_after_classify({"request_kind": "explain"}) == "explain"


def test_route_after_classify_abort():
    assert route_after_classify({"request_kind": "abort"}) == "abort"


def test_route_after_classify_code_paths_go_to_plan():
    for kind in ("new_app", "feature", "bug_fix", "refactor", "api_design", "edit", "delete"):
        assert route_after_classify({"request_kind": kind}) == "workflow_plan"


def test_workflow_id_mapping():
    assert workflow_id_for_kind("new_app") == "new_app"
    assert workflow_id_for_kind("bug_fix") == "debug"
    assert workflow_id_for_kind("refactor") == "refactor"
    assert workflow_id_for_kind("api_design") == "api_design"
    assert workflow_id_for_kind("edit") == "edit"
    assert workflow_id_for_kind("delete") == "delete"
    assert workflow_id_for_kind("unknown") == "feature"
