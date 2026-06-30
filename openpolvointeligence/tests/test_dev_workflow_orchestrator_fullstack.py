"""Testes do orchestrator full-stack."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.dev_workflow_orchestrator_logic import (
    build_tasks_from_plan,
    topological_sort_tasks,
)


def test_build_tasks_includes_backend_and_frontend_paths():
    plan = {
        "files_to_create": [
            "backend/internal/app/tasks/domain/task.go",
            "frontend/src/pages/TasksPage.tsx",
        ],
        "files_to_modify": ["backend/internal/transport/http/router.go"],
        "_project_files": {},
    }
    tasks = build_tasks_from_plan(plan)
    paths = [t["path"] for t in tasks]
    assert "backend/internal/app/tasks/domain/task.go" in paths
    assert "frontend/src/pages/TasksPage.tsx" in paths


def test_build_tasks_includes_server_paths():
    plan = {
        "files_to_create": [
            "server/db/schema.ts",
            "server/routes/tasks.ts",
            "src/pages/TasksPage.tsx",
        ],
        "files_to_modify": ["server/index.ts", "src/lib/api.ts"],
        "_project_files": {},
    }
    tasks = build_tasks_from_plan(plan)
    paths = [t["path"] for t in tasks]
    assert "server/db/schema.ts" in paths
    assert "server/routes/tasks.ts" in paths
    assert "src/pages/TasksPage.tsx" in paths


def test_topological_sort_schema_before_routes():
    tasks = [
        {
            "order": 1,
            "path": "server/routes/items.ts",
            "action": "create",
            "depends_on": ["server/db/schema.ts"],
            "summary": "routes",
            "expected_exports": ["default"],
        },
        {
            "order": 2,
            "path": "server/db/schema.ts",
            "action": "create",
            "depends_on": [],
            "summary": "schema",
            "expected_exports": ["default"],
        },
    ]
    sorted_tasks = topological_sort_tasks(tasks)
    assert sorted_tasks[0]["path"] == "server/db/schema.ts"
