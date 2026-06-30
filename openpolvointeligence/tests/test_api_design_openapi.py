"""Testes do workflow api_design — classificação e validação OpenAPI."""

from openpolvointeligence.graphs.dev_workflow.core.workflow_helpers import is_valid_openapi_spec
from openpolvointeligence.graphs.dev_workflow.dev_workflow_request_kind import classify_request_kind


def test_classify_api_design_from_keywords():
    kind = classify_request_kind(
        "cria endpoints REST com swagger e documentação OpenAPI",
        has_project=True,
    )
    assert kind == "api_design"


def test_valid_openapi_spec_minimal():
    spec = {
        "openapi": "3.1.0",
        "info": {"title": "Test", "version": "1.0.0"},
        "paths": {"/health": {"get": {"summary": "Health check"}}},
    }
    assert is_valid_openapi_spec(spec) is True


def test_invalid_openapi_spec_missing_paths():
    assert is_valid_openapi_spec({"openapi": "3.0.0", "info": {}}) is False


def test_invalid_openapi_spec_wrong_version():
    assert is_valid_openapi_spec({"swagger": "2.0", "paths": {"/x": {}}}) is False
