"""Testes do agente workspace_opener."""

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.agents.workspace_opener import (
    run_workspace_opener_agent,
)


async def test_workspace_opener_sets_open_flag_for_new_app():
    settings = Settings()
    state = {
        "request_kind": "new_app",
        "workspace_id": "/tmp/ws",
        "feature_summary": "App de Tarefas",
        "pending_writes": [
            {"op": "write", "path": "app-tarefas/package.json", "content": "{}"},
        ],
    }
    patch = await run_workspace_opener_agent(settings, state)
    assert patch.get("polvo_code_open_workspace") is True
    assert patch.get("polvo_code_project_root")
