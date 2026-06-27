"""Testes do loop worker+revisor (Dev Workflow Teams)."""

from __future__ import annotations

import pytest

from openpolvointeligence.graphs.dev_workflow.dev_workflow_review_logic import parse_review_response
from openpolvointeligence.graphs.dev_workflow.dev_workflow_team import run_team_review_loop


@pytest.mark.asyncio
async def test_team_loop_approves_on_first_round():
    calls = {"worker": 0, "reviewer": 0}

    async def worker(guidance: str | None) -> dict:
        calls["worker"] += 1
        return {"value": guidance or "ok"}

    async def reviewer(artifact: dict) -> dict:
        calls["reviewer"] += 1
        return {"approved": True, "score": 1.0, "issues": [], "guidance": ""}

    artifact, review, trace = await run_team_review_loop(
        team_name="test",
        worker=worker,
        reviewer=reviewer,
        max_rounds=3,
    )
    assert artifact["value"] == "ok"
    assert review["approved"] is True
    assert calls["worker"] == 1
    assert calls["reviewer"] == 1
    assert any("test:review:r1:ok" in t for t in trace)


@pytest.mark.asyncio
async def test_team_loop_retries_until_approved():
    calls = {"worker": 0}

    async def worker(guidance: str | None) -> str:
        calls["worker"] += 1
        return guidance or "v1"

    async def reviewer(artifact: str) -> dict:
        if calls["worker"] < 2:
            return {
                "approved": False,
                "score": 0.4,
                "issues": [{"message": "fix it"}],
                "guidance": "improve",
            }
        return {"approved": True, "score": 1.0, "issues": [], "guidance": ""}

    artifact, review, trace = await run_team_review_loop(
        team_name="retry",
        worker=worker,
        reviewer=reviewer,
        max_rounds=3,
    )
    assert calls["worker"] == 2
    assert review["approved"] is True
    assert artifact.startswith("improve")


@pytest.mark.asyncio
async def test_team_loop_deterministic_gate_skips_reviewer():
    calls = {"reviewer": 0}

    async def worker(_: str | None) -> str:
        return "artifact"

    async def reviewer(_: str) -> dict:
        calls["reviewer"] += 1
        return {"approved": False, "score": 0.0, "issues": [], "guidance": ""}

    def gate(_: str) -> tuple[bool, list[str]]:
        return True, []

    _, review, trace = await run_team_review_loop(
        team_name="gate",
        worker=worker,
        reviewer=reviewer,
        max_rounds=3,
        deterministic_gate=gate,
        skip_reviewer_on_gate=True,
    )
    assert calls["reviewer"] == 0
    assert review.get("gate") == "deterministic"
    assert any("gate:ok" in t for t in trace)


def test_parse_review_response_normalizes():
    raw = '{"approved": false, "score": 0.5, "issues": [{"message": "x"}], "guidance": "fix"}'
    r = parse_review_response(raw)
    assert r["approved"] is False
    assert r["score"] == 0.5
    assert len(r["issues"]) == 1
