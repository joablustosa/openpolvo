"""Testes do orquestrador Dev Workflow."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.dev_workflow_orchestrator_logic import (
    build_tasks_from_plan,
    normalize_build_tasks,
    topological_sort_tasks,
    validate_orchestration,
)


def test_build_tasks_from_plan_create_and_modify():
    plan = {
        "files_to_create": ["src/components/Hero.tsx", "src/pages/LandingPage.tsx"],
        "files_to_modify": [],
        "_project_files": {},
    }
    tasks = build_tasks_from_plan(plan)
    paths = [t["path"] for t in tasks]
    assert "src/components/Hero.tsx" in paths
    assert "src/pages/LandingPage.tsx" in paths


def test_topological_sort_respects_dependencies():
    tasks = [
        {"path": "src/pages/LandingPage.tsx", "depends_on": ["src/components/Hero.tsx"]},
        {"path": "src/components/Hero.tsx", "depends_on": []},
    ]
    ordered = topological_sort_tasks(tasks)
    hero_idx = next(i for i, t in enumerate(ordered) if "Hero" in t["path"])
    page_idx = next(i for i, t in enumerate(ordered) if "LandingPage" in t["path"])
    assert hero_idx < page_idx


def test_validate_orchestration_missing_tasks():
    plan = {
        "files_to_create": ["src/pages/Home.tsx"],
        "files_to_modify": [],
    }
    ok, errs = validate_orchestration([], plan)
    assert ok is False
    assert any("falta" in e or "nenhuma" in e for e in errs)


def test_normalize_build_tasks_fallback():
    plan = {
        "files_to_create": ["src/components/Footer.tsx"],
        "files_to_modify": [],
    }
    tasks = normalize_build_tasks([], plan)
    assert len(tasks) >= 1
    assert tasks[0]["path"] == "src/components/Footer.tsx"
