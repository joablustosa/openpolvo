"""Testes do codegen por build_task (sem LLM)."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.dev_workflow_codegen_per_task import (
    _dedupe_ops_by_path,
    _narrow_plan_for_task,
    _tasks_for_paths,
    plan_paths_from_plan,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_team_integration import gate_codegen_result


def test_plan_paths_from_plan():
    plan = {
        "files_to_create": ["frontend/src/pages/Home.tsx"],
        "files_to_modify": ["backend/internal/transport/http/router.go"],
    }
    paths = plan_paths_from_plan(plan)
    assert paths == {
        "frontend/src/pages/Home.tsx",
        "backend/internal/transport/http/router.go",
    }


def test_narrow_plan_for_task_create():
    plan = {
        "files_to_create": ["a.tsx", "b.tsx"],
        "files_to_modify": [],
    }
    narrow = _narrow_plan_for_task(plan, {"path": "a.tsx", "action": "create"})
    assert narrow["files_to_create"] == ["a.tsx"]
    assert narrow["files_to_modify"] == []


def test_dedupe_ops_by_path_last_wins():
    ops = [
        {"op": "write", "path": "a.tsx", "content": "v1"},
        {"op": "write", "path": "a.tsx", "content": "v2"},
    ]
    deduped = _dedupe_ops_by_path(ops)
    writes = [o for o in deduped if o.get("op") == "write"]
    assert len(writes) == 1
    assert writes[0]["content"] == "v2"


def test_gate_codegen_result_missing_paths():
    plan = {"files_to_create": ["a.tsx", "b.tsx"], "files_to_modify": []}
    result = {
        "polvo_code_ops": [{"op": "write", "path": "a.tsx", "content": "x"}],
        "validation_errors": [],
    }
    ok, errs = gate_codegen_result(result, plan)
    assert not ok
    assert any("paths em falta" in e for e in errs)


def test_gate_codegen_result_full_coverage():
    plan = {"files_to_create": ["a.tsx"], "files_to_modify": []}
    result = {
        "polvo_code_ops": [{"op": "write", "path": "a.tsx", "content": "x"}],
        "validation_errors": [],
    }
    ok, errs = gate_codegen_result(result, plan)
    assert ok
    assert not errs


def test_tasks_for_paths_fallback():
    tasks = _tasks_for_paths([], {"x.tsx", "y.tsx"})
    assert len(tasks) == 2
    assert {t["path"] for t in tasks} == {"x.tsx", "y.tsx"}
