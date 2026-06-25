"""Routing PDF antes do desk graph."""

from __future__ import annotations

from openpolvointeligence.graphs.desk_routing import should_use_desk_graph
from openpolvointeligence.graphs.zepolvinho_graph import wants_pdf_study_specialist


def test_pdf_request_bypasses_desk_even_with_agent_context() -> None:
    desk = {"mode": "agent", "workspace_path": "/tmp", "conversation_id": "c1"}
    assert should_use_desk_graph(desk) is True
    assert wants_pdf_study_specialist("Faça um estudo de mercado e retorne em PDF")
