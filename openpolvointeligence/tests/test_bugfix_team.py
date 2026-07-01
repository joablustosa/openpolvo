"""Testes do bug-fix team (B1) — detect (triage) → fix → verify → relatório.

Sem LLM real: a triagem é determinística; o delivery gate usa um port fake.
Verifica que o fluxo debug ganhou triagem + build graceful + relatório, sem alterar
os outros workflows.
"""

from __future__ import annotations

import pytest

from openpolvointeligence.core.config import Settings


# ── Triagem (detect determinístico) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_triage_classifies_and_extracts_signal():
    from openpolvointeligence.graphs.dev_workflow.agents.bugfix_triage import (
        run_bugfix_triage_agent,
    )

    state = {
        "user_prompt": "Dá TypeError: Cannot read properties of undefined em src/App.tsx",
        "project_files": {"src/App.tsx": "x", "src/util.ts": "y"},
        "dev_workflow_error_memory_enabled": False,
    }
    patch = await run_bugfix_triage_agent(Settings(dev_workflow_error_memory_enabled=False), state)
    report = patch["bugfix_report"]
    assert patch["bug_category"] == "runtime"
    assert "TypeError" in report["symptom"]
    assert "src/App.tsx" in report["suspect_paths"]
    assert report["phase"] == "detect"
    assert "triage" in patch["completed_steps"]


@pytest.mark.asyncio
async def test_triage_integration_category():
    from openpolvointeligence.graphs.dev_workflow.agents.bugfix_triage import (
        run_bugfix_triage_agent,
    )

    state = {"user_prompt": "o fetch para a API devolve 500 e o formulário não envia"}
    patch = await run_bugfix_triage_agent(Settings(dev_workflow_error_memory_enabled=False), state)
    assert patch["bug_category"] == "integration"


@pytest.mark.asyncio
async def test_triage_no_project_no_suspects():
    from openpolvointeligence.graphs.dev_workflow.agents.bugfix_triage import (
        run_bugfix_triage_agent,
    )

    patch = await run_bugfix_triage_agent(
        Settings(dev_workflow_error_memory_enabled=False), {"user_prompt": "está quebrado"}
    )
    assert patch["bugfix_report"]["suspect_paths"] == []


# ── Registo no fluxo debug (sem alterar outros workflows) ─────────────────────


def test_debug_workflow_has_triage_first():
    from openpolvointeligence.graphs.dev_workflow.workflows import debug_workflow, feature_workflow

    assert debug_workflow.STEPS[0] == "triage"
    assert "triage" in debug_workflow.STEPS
    # Outros workflows não ganham triage.
    assert "triage" not in feature_workflow.STEPS


def test_triage_registered_in_runners():
    from openpolvointeligence.graphs.dev_workflow.agents.runners import AGENT_RUNNERS

    assert "triage" in AGENT_RUNNERS


def test_debug_graph_builds_with_triage():
    from openpolvointeligence.graphs.dev_workflow.workflows.graph_factory import (
        build_workflow_graph,
    )

    # Não deve levantar ao construir o grafo com o novo primeiro passo.
    assert build_workflow_graph(Settings(), "debug") is not None


# ── Verify reforçado: build graceful no delivery gate do debug ────────────────


class _FakeResult:
    def __init__(self, ok, out):
        self.ok = ok
        self._out = out

    def output(self):
        return self._out


class _FakePort:
    def __init__(self, files=None):
        self.files = files or {}
        self.commands = []

    async def run(self, command, *, cwd=None):
        self.commands.append(command)
        return _FakeResult(True, "ok")

    def read(self, path):
        return self.files.get(path, "")

    async def git_status(self):
        return _FakeResult(True, "M x")

    async def git_diff(self):
        return _FakeResult(True, "diff")


@pytest.mark.asyncio
async def test_debug_gate_runs_build_when_script_present():
    from openpolvointeligence.graphs.dev_workflow.workflows.delivery_gates import (
        run_delivery_gate_checks,
    )

    files = {"package.json": '{"scripts": {"build": "vite build", "test": "vitest"}}'}
    port = _FakePort(files)
    res = await run_delivery_gate_checks(Settings(), {"project_files": files}, port, "debug")
    assert "build" in res["checks_run"]
    assert res["passed"] is True


@pytest.mark.asyncio
async def test_debug_gate_skips_build_without_script():
    from openpolvointeligence.graphs.dev_workflow.workflows.delivery_gates import (
        run_delivery_gate_checks,
    )

    files = {"package.json": '{"scripts": {"test": "vitest"}}'}
    port = _FakePort(files)
    res = await run_delivery_gate_checks(Settings(), {"project_files": files}, port, "debug")
    assert "build" not in res["checks_run"]  # projeto sem build não é penalizado


@pytest.mark.asyncio
async def test_debug_gate_build_disabled_by_flag():
    from openpolvointeligence.graphs.dev_workflow.workflows.delivery_gates import (
        run_delivery_gate_checks,
    )

    files = {"package.json": '{"scripts": {"build": "vite build"}}'}
    port = _FakePort(files)
    res = await run_delivery_gate_checks(
        Settings(dev_workflow_debug_build_check=False), {"project_files": files}, port, "debug"
    )
    assert "build" not in res["checks_run"]


# ── Relatório estruturado no deliver ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_deliver_emits_bugfix_report():
    from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import node_deliver

    state = {
        "workflow_id": "debug",
        "request_kind": "bug_fix",
        "bugfix_report": {
            "category": "runtime",
            "symptom": "TypeError x",
            "suspect_paths": ["src/App.tsx"],
        },
        "delivery_gate_result": {
            "passed": True,
            "checks_run": ["tsc", "tests", "build"],
            "failures": [],
        },
        "polvo_code_ops": [{"op": "write", "path": "src/App.tsx", "content": "fixed"}],
        "pending_writes": [],
    }
    out = await node_deliver(Settings(), state)
    report = out["bugfix_report"]
    assert report["phase"] == "verified"
    assert report["verification"]["passed"] is True
    assert "build" in report["verification"]["checks_run"]
    assert report["files_changed"] == ["src/App.tsx"]
    # texto genérico substituído pelo resumo estruturado
    assert "Bug-fix" in out["assistant_text"]
    assert out["deliverable"]["bugfix_report"]["category"] == "runtime"


@pytest.mark.asyncio
async def test_deliver_without_bugfix_report_is_unchanged():
    from openpolvointeligence.graphs.dev_workflow.workflows.shared_nodes import node_deliver

    state = {
        "workflow_id": "feature",
        "request_kind": "feature",
        "polvo_code_ops": [{"op": "write", "path": "src/x.ts", "content": "y"}],
    }
    out = await node_deliver(Settings(), state)
    assert "bugfix_report" not in out
    assert "bugfix_report" not in out["deliverable"]
