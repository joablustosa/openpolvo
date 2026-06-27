"""Loop worker+revisor reutilizável para times do Dev Workflow."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

T = TypeVar("T")

WorkerFn = Callable[[str | None], Awaitable[T]]
ReviewerFn = Callable[[T], Awaitable[dict[str, Any]]]
DeterministicGateFn = Callable[[T], tuple[bool, list[str]]]


async def run_team_review_loop(
    *,
    team_name: str,
    worker: WorkerFn[T],
    reviewer: ReviewerFn[T],
    max_rounds: int = 3,
    deterministic_gate: DeterministicGateFn[T] | None = None,
    skip_reviewer_on_gate: bool = True,
) -> tuple[T, dict[str, Any], list[str]]:
    """
    Executa worker → (gate determinístico?) → revisor até aprovação ou esgotar rondas.

    Returns:
        (artefacto_final, review_dict, team_trace)
    """
    guidance: str | None = None
    trace: list[str] = []
    artifact: T | None = None
    last_review: dict[str, Any] = {
        "approved": False,
        "score": 0.0,
        "issues": [],
        "guidance": "",
    }
    rounds = max(1, int(max_rounds))

    for round_idx in range(1, rounds + 1):
        artifact = await worker(guidance)
        trace.append(f"{team_name}:worker:r{round_idx}")

        gate_ok = False
        gate_issues: list[str] = []
        if deterministic_gate is not None:
            gate_ok, gate_issues = deterministic_gate(artifact)
            if gate_ok and skip_reviewer_on_gate:
                last_review = {
                    "approved": True,
                    "score": 1.0,
                    "issues": [],
                    "guidance": "",
                    "gate": "deterministic",
                }
                trace.append(f"{team_name}:gate:ok:r{round_idx}")
                break
            if gate_issues:
                trace.append(f"{team_name}:gate:fail:r{round_idx}:{len(gate_issues)}")

        review = await reviewer(artifact)
        last_review = review
        approved = bool(review.get("approved"))
        score = float(review.get("score") or 0.0)
        issues = review.get("issues") or []
        trace.append(
            f"{team_name}:review:r{round_idx}:{'ok' if approved else 'fail'}:{score:.2f}",
        )

        if approved:
            break

        guidance_parts: list[str] = []
        if gate_issues:
            guidance_parts.append("Validação determinística:\n- " + "\n- ".join(gate_issues[:8]))
        rev_guidance = str(review.get("guidance") or "").strip()
        if rev_guidance:
            guidance_parts.append(rev_guidance)
        issue_lines = [
            str(i.get("message") if isinstance(i, dict) else i)
            for i in (issues if isinstance(issues, list) else [])
        ]
        if issue_lines:
            guidance_parts.append("Issues:\n- " + "\n- ".join(issue_lines[:8]))
        guidance = "\n\n".join(guidance_parts) if guidance_parts else None

    assert artifact is not None
    return artifact, last_review, trace
