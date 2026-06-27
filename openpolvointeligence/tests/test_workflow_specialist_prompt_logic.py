"""Testes da lógica determinística do agente especialista de workflows."""

from __future__ import annotations

import json

from openpolvointeligence.graphs.workflow_specialist_prompt_logic import (
    graph_to_raw_json,
    normalize_brief,
    normalize_steps,
    parse_json_block,
    steps_to_graph,
    validate_graph,
)


def test_parse_json_block_strips_fences() -> None:
    raw = """```json
{"title": "Bot diário", "description": "Faz X"}
```"""
    data = parse_json_block(raw)
    assert data["title"] == "Bot diário"


def test_normalize_brief_defaults() -> None:
    brief = normalize_brief({}, raw="Quero um agente que publica no Instagram")
    assert brief["title"]
    assert brief["description"]
    assert brief["trigger"]
    assert isinstance(brief["integrations"], list)


def test_normalize_steps_coerces_types_and_unique_ids() -> None:
    steps = normalize_steps(
        [
            {"id": "n1", "type": "navigate", "label": "Abrir", "url": "https://x.com"},
            {"id": "n1", "type": "ai", "prompt": "Resume"},
            {"type": "search", "query": "noticias"},
        ]
    )
    assert len(steps) == 3
    ids = [s["id"] for s in steps]
    assert len(set(ids)) == 3  # IDs únicos garantidos
    assert steps[0]["type"] == "goto"  # navigate → goto
    assert steps[1]["type"] == "llm"  # ai → llm
    assert steps[2]["type"] == "web_search"  # search → web_search


def test_steps_to_graph_chains_edges_and_positions() -> None:
    steps = normalize_steps(
        [
            {"id": "n1", "type": "schedule", "cron": "0 9 * * *", "prompt": "Diário"},
            {"id": "n2", "type": "llm", "prompt": "Gera texto"},
            {"id": "n3", "type": "send_email", "email_to": "a@b.com", "prompt": "Envia"},
        ]
    )
    graph = steps_to_graph(steps)
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2  # n1→n2, n2→n3
    assert graph["edges"][0]["source"] == "n1"
    assert graph["edges"][0]["target"] == "n2"
    # Cada nó preserva o prompt do passo e a posição.
    assert graph["nodes"][1]["data"]["prompt"] == "Gera texto"
    assert "position" in graph["nodes"][0]
    # web_search/email mapeiam os seus campos.
    assert graph["nodes"][2]["data"]["email_to"] == "a@b.com"
    assert graph["nodes"][0]["data"]["cron"] == "0 9 * * *"


def test_validate_graph_removes_invalid_edges() -> None:
    graph = {
        "nodes": [
            {"id": "n1", "type": "llm", "data": {}},
            {"id": "n1", "type": "goto", "data": {}},  # duplicado
        ],
        "edges": [
            {"id": "e1", "source": "n1", "target": "n9"},  # alvo inexistente
        ],
    }
    clean, notes = validate_graph(graph)
    assert len(clean["nodes"]) == 1  # duplicado removido
    assert clean["edges"] == []  # aresta inválida removida
    assert notes


def test_graph_to_raw_json_roundtrip() -> None:
    graph = {"nodes": [{"id": "n1", "type": "llm", "data": {"prompt": "X"}}], "edges": []}
    raw = graph_to_raw_json(graph)
    parsed = json.loads(raw)
    assert parsed["nodes"][0]["data"]["prompt"] == "X"


def test_web_search_query_falls_back_to_prompt() -> None:
    steps = normalize_steps([{"id": "n1", "type": "web_search", "prompt": "ultimas noticias IA"}])
    graph = steps_to_graph(steps)
    assert graph["nodes"][0]["data"]["query"] == "ultimas noticias IA"
