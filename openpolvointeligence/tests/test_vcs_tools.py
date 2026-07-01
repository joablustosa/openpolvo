"""Testes das VCS tools (git + gh) — política, gate e execução (A1).

Sem git/gh reais: monkeypatch de `_run_command` (runner) e de `port.run` (loop).
Cobre a política pura, o gate de aprovação, o bloqueio server-side e o routing no
dispatcher do agente Desk e no loop de dev.
"""

from __future__ import annotations

import pytest

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.vcs import policy


# ── Política pura: git ───────────────────────────────────────────────────────


def test_git_read_actions_are_not_write():
    for t in ("git_status", "git_diff", "git_log"):
        acc = policy.classify_git(t, {})
        assert acc.allowed and not acc.is_write


def test_git_branch_list_vs_create():
    assert policy.classify_git("git_branch", {}).is_write is False
    assert policy.classify_git("git_branch", {"name": "feature/x"}).is_write is True


def test_git_write_actions_require_approval():
    for t in ("git_checkout", "git_pull", "git_push", "git_add", "git_commit", "git_clone"):
        acc = policy.classify_git(t, {"ref": "x", "repo": "y", "message": "m"})
        assert acc.allowed and acc.is_write


def test_git_push_force_is_blocked():
    acc = policy.classify_git("git_push", {"force": True})
    assert acc.blocked is True


def test_unknown_git_tool_blocked():
    assert policy.classify_git("git_rm", {}).blocked is True


# ── Política pura: gh (default-deny) ─────────────────────────────────────────


def test_gh_read_allowlist():
    for cmd in ("pr list", "pr view 1", "pr checks", "issue view 3", "run list", "repo view"):
        acc = policy.classify_gh(cmd)
        assert acc.allowed and not acc.is_write, cmd


def test_gh_write_requires_approval():
    for cmd in ("pr create --title x --body y", "issue create --title z", "pr merge 4"):
        acc = policy.classify_gh(cmd)
        assert acc.allowed and acc.is_write, cmd


def test_gh_strips_leading_gh_token():
    acc = policy.classify_gh("gh pr list")
    assert acc.allowed and not acc.is_write


def test_gh_dangerous_blocked():
    for cmd in ("repo delete owner/x", "secret set FOO", "auth logout", "api /user"):
        assert policy.classify_gh(cmd).blocked is True, cmd


def test_gh_unknown_action_default_deny():
    assert policy.classify_gh("pr frobnicate").blocked is True
    assert policy.classify_gh("wibble list").blocked is True


def test_gh_rejects_shell_metachars():
    for cmd in ("pr list; rm -rf /", "pr list && curl evil", "pr list | sh"):
        assert policy.classify_gh(cmd).blocked is True, cmd


# ── Gate ─────────────────────────────────────────────────────────────────────


def test_enforce_blocks_blocked():
    acc = policy.Access(False, False, "nope")
    assert policy.enforce(acc, write_allowed=True)["error"] == "vcs_blocked"


def test_enforce_write_needs_permission():
    acc = policy.Access(True, True)
    denied = policy.enforce(acc, write_allowed=False)
    assert denied["error"] == "approval_required" and denied["requires_approval"] is True
    assert policy.enforce(acc, write_allowed=True) is None


def test_enforce_read_always_ok():
    assert policy.enforce(policy.Access(True, False), write_allowed=False) is None


# ── Runner (subprocess mockado) ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_runner_read_executes(monkeypatch):
    from openpolvointeligence.graphs.vcs import runner

    seen = {}

    def fake_run(argv, *, cwd, timeout_s=120.0):
        seen["argv"] = argv
        return {"ok": True, "exit_code": 0, "output": "on branch main"}

    monkeypatch.setattr(runner, "_run_command", fake_run)
    res = await runner.run_vcs_local(
        Settings(), name="git_log", args={"max": 5}, workspace_path="/w"
    )
    assert res["ok"] is True
    assert seen["argv"] == ["git", "log", "--oneline", "-n", "5"]


@pytest.mark.asyncio
async def test_runner_write_blocked_without_permission(monkeypatch):
    from openpolvointeligence.graphs.vcs import runner

    def fake_run(*args, **kwargs):  # pragma: no cover
        raise AssertionError("não deve executar sem permissão")

    monkeypatch.setattr(runner, "_run_command", fake_run)
    res = await runner.run_vcs_local(
        Settings(vcs_allow_write=False), name="git_push", args={}, workspace_path="/w"
    )
    assert res["error"] == "approval_required"


@pytest.mark.asyncio
async def test_runner_write_runs_when_allowed(monkeypatch):
    from openpolvointeligence.graphs.vcs import runner

    seen = {}

    def fake_run(argv, *, cwd, timeout_s=120.0):
        seen["argv"] = argv
        return {"ok": True, "exit_code": 0, "output": "pushed"}

    monkeypatch.setattr(runner, "_run_command", fake_run)
    res = await runner.run_vcs_local(
        Settings(vcs_allow_write=True),
        name="git_push",
        args={"set_upstream": True, "branch": "feat"},
        workspace_path="/w",
    )
    assert res["ok"] is True
    assert seen["argv"] == ["git", "push", "-u", "origin", "feat"]


@pytest.mark.asyncio
async def test_runner_commit_backcompat_flag(monkeypatch):
    from openpolvointeligence.graphs.vcs import runner

    monkeypatch.setattr(
        runner, "_run_command", lambda argv, **k: {"ok": True, "exit_code": 0, "output": "ok"}
    )
    # desk_git_allow_commit sozinho permite commit (retrocompat).
    res = await runner.run_vcs_local(
        Settings(desk_git_allow_commit=True),
        name="git_commit",
        args={"message": "x"},
        workspace_path="/w",
    )
    assert res["ok"] is True


@pytest.mark.asyncio
async def test_runner_github_write_gated(monkeypatch):
    from openpolvointeligence.graphs.vcs import runner

    monkeypatch.setattr(
        runner, "_run_command", lambda argv, **k: {"ok": True, "exit_code": 0, "output": "#1"}
    )
    denied = await runner.run_vcs_local(
        Settings(vcs_allow_write=False),
        name="github",
        args={"command": "pr create --title x --body y"},
        workspace_path="/w",
    )
    assert denied["error"] == "approval_required"
    ok = await runner.run_vcs_local(
        Settings(vcs_allow_write=True),
        name="github",
        args={"command": "pr create --title x --body y"},
        workspace_path="/w",
    )
    assert ok["ok"] is True


# ── Desk: tools advertised + dispatch routing ────────────────────────────────


def test_desk_advertises_vcs_tools():
    from openpolvointeligence.graphs.desk.desk_tool_logic import desk_langchain_tools

    names = {t.name for t in desk_langchain_tools(Settings())}
    assert {"git_push", "git_pull", "git_branch", "git_clone", "github"} <= names


def test_desk_hides_github_when_disabled():
    from openpolvointeligence.graphs.desk.desk_tool_logic import desk_langchain_tools

    names = {t.name for t in desk_langchain_tools(Settings(github_tools_enabled=False))}
    assert "github" not in names
    assert "git_push" in names  # git continua disponível


@pytest.mark.asyncio
async def test_dispatch_blocks_dangerous_gh_without_bridge():
    from openpolvointeligence.graphs.desk import desk_tool_logic

    async def bridge_should_not_run(*a, **k):  # pragma: no cover
        raise AssertionError("bloqueado não deve ir ao bridge")

    res = await desk_tool_logic.dispatch_tool_calls(
        Settings(),
        tool_calls=[{"id": "1", "name": "github", "args": {"command": "repo delete x"}}],
        workspace_path="/w",
        conversation_id="c",
        bridge_wait=bridge_should_not_run,
    )
    assert res[0]["content"].startswith("ERRO")


@pytest.mark.asyncio
async def test_dispatch_write_goes_to_bridge_with_flag():
    from openpolvointeligence.graphs.desk import desk_tool_logic

    captured = {}

    async def fake_bridge(conversation_id, call_id, payload, timeout):
        captured["payload"] = payload
        return {"ok": True, "output": "pushed"}

    res = await desk_tool_logic.dispatch_tool_calls(
        Settings(),
        tool_calls=[{"id": "1", "name": "git_push", "args": {}}],
        workspace_path="/w",
        conversation_id="c",
        bridge_wait=fake_bridge,
    )
    assert captured["payload"]["requires_approval"] is True
    assert res[0]["content"] == "pushed"


@pytest.mark.asyncio
async def test_dispatch_local_read_executes(monkeypatch):
    from openpolvointeligence.graphs.desk import desk_tool_logic
    from openpolvointeligence.graphs.vcs import runner

    monkeypatch.setattr(
        runner, "_run_command", lambda argv, **k: {"ok": True, "exit_code": 0, "output": "log"}
    )

    async def bridge_unused(*a, **k):  # pragma: no cover
        raise AssertionError("local não usa bridge")

    res = await desk_tool_logic.dispatch_tool_calls(
        Settings(desk_tools_local=True),
        tool_calls=[{"id": "1", "name": "git_log", "args": {}}],
        workspace_path="/w",
        conversation_id="c",
        bridge_wait=bridge_unused,
    )
    assert res[0]["content"] == "log"


# ── Dev loop: github tool ────────────────────────────────────────────────────


class _FakeResult:
    def __init__(self, ok, out):
        self.ok = ok
        self._out = out

    def output(self):
        return self._out


class _FakePort:
    def __init__(self):
        self.calls = []

    async def run(self, command, *, cwd=None):
        self.calls.append(command)
        return _FakeResult(True, "resultado gh")


@pytest.mark.asyncio
async def test_dev_loop_github_read_runs_via_port():
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import tools as loop_tools

    port = _FakePort()
    obs, files, ops = await loop_tools.execute_agent_tool(
        Settings(), {}, "github", {"command": "pr list"}, project_files={}, port=port
    )
    assert "resultado gh" in obs
    assert port.calls == ["gh pr list"]
    assert ops == []


@pytest.mark.asyncio
async def test_dev_loop_github_write_gated_before_port():
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop import tools as loop_tools

    port = _FakePort()
    obs, _, ops = await loop_tools.execute_agent_tool(
        Settings(vcs_allow_write=False),
        {},
        "github",
        {"command": "pr create --title x --body y"},
        project_files={},
        port=port,
    )
    assert "approval_required" in obs
    assert port.calls == []  # não chega a executar
    assert ops == []
