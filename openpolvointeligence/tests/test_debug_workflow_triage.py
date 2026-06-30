"""Testes de triagem determinística do workflow debug."""

from openpolvointeligence.graphs.dev_workflow.core.workflow_dispatch import workflow_id_for_kind
from openpolvointeligence.graphs.dev_workflow.core.workflow_helpers import triage_bug_category
from openpolvointeligence.graphs.dev_workflow.dev_workflow_request_kind import classify_request_kind


def test_bug_fix_maps_to_debug_workflow():
    assert workflow_id_for_kind("bug_fix") == "debug"


def test_runtime_error_triage():
    assert triage_bug_category("undefined is not a function no console do preview") == "runtime"


def test_integration_error_triage():
    assert (
        triage_bug_category("o formulário não envia os dados para a API e dá 500") == "integration"
    )


def test_logic_bug_triage():
    assert triage_bug_category("a regra de negócio do desconto está errada") == "logic"


def test_stack_trace_classifies_as_bug_fix():
    kind = classify_request_kind(
        "TypeError: Cannot read properties of undefined (reading 'map')",
        has_project=True,
    )
    assert kind == "bug_fix"
