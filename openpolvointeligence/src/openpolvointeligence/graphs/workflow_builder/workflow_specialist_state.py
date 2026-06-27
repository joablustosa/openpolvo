"""Estado tipado do agente especialista de automações/workflows."""

from __future__ import annotations

from typing import Any, TypedDict


class WorkflowSpecialistState(TypedDict, total=False):
    model_provider: str | None
    user_query: str
    recording_hint: str
    automation_brief: dict[str, Any]
    step_blueprint: list[dict[str, Any]]
    graph_json: dict[str, Any]
    validation_notes: list[str]
    raw_llm: str
    assistant_text: str
    metadata: dict[str, Any]
    trace: list[str]
