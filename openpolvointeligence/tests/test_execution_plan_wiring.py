"""Testes de wiring execution_plan → architect/codegen."""

from openpolvointeligence.graphs.dev_workflow.agents.agent_context import (
    build_agent_context_block,
    merge_execution_plan_into_targets,
)


def test_merge_execution_plan_fills_missing_create_paths():
    state = {
        "execution_plan": {
            "steps": [
                {"name": "frontend", "files": ["src/pages/Reports.tsx"]},
                {"name": "api", "files": ["server/routes/reports.ts"]},
            ],
        },
    }
    plan = merge_execution_plan_into_targets(state, {})
    assert "src/pages/Reports.tsx" in plan["files_to_create"]
    assert "server/routes/reports.ts" in plan["files_to_create"]


def test_merge_openapi_paths_into_create():
    state = {
        "execution_plan": {"steps": []},
        "openapi_spec": {"paths": {"/reports": {}, "/users/{id}": {}}},
    }
    plan = merge_execution_plan_into_targets(state, {})
    paths = plan["files_to_create"]
    assert any("reports" in p for p in paths)
    assert any("users" in p for p in paths)


def test_merge_refactor_targets():
    state = {
        "refactor_plan": {"targets": ["src/lib/auth.ts", "server/middleware/auth.ts"]},
    }
    plan = merge_execution_plan_into_targets(state, {})
    assert plan["files_to_create"] == [
        "src/lib/auth.ts",
        "server/middleware/auth.ts",
    ]


def test_merge_does_not_override_existing_architect_plan():
    state = {
        "execution_plan": {"steps": [{"files": ["src/pages/Other.tsx"]}]},
    }
    plan = merge_execution_plan_into_targets(
        state,
        {"files_to_create": ["src/App.tsx"], "files_to_modify": []},
    )
    assert plan["files_to_create"] == ["src/App.tsx"]


def test_build_agent_context_block_includes_artefacts():
    block = build_agent_context_block(
        {
            "execution_plan": {"summary": "todo app"},
            "requirements": {"functional_requirements": ["auth"]},
            "openapi_spec": {"paths": {"/health": {}}},
        },
    )
    assert "execution_plan" in block
    assert "requirements" in block
    assert "openapi_spec" in block
