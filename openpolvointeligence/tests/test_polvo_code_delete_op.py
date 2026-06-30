"""Validação de operações polvo_code incluindo delete."""

from openpolvointeligence.graphs.dev_workflow.polvo_code_metadata import (
    validate_polvo_code_operations,
)


def test_validate_delete_op():
    valid, errors = validate_polvo_code_operations(
        [{"op": "delete", "path": "src/components/Old.tsx"}],
    )
    assert not errors
    assert valid == [{"op": "delete", "path": "src/components/Old.tsx"}]


def test_reject_delete_directory_path():
    valid, errors = validate_polvo_code_operations(
        [{"op": "delete", "path": "src/components/"}],
    )
    assert not valid
    assert errors
