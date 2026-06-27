"""Lógica determinística (zero-token) do agente especialista de workflows.

Converte o brief e o blueprint de passos do LLM num GraphJSON válido para o
backend (nós + arestas estilo React Flow), garantindo IDs únicos, tipos de nó
suportados pelo runner e posições em grelha para o editor visual.
"""

from __future__ import annotations

import json
import re
from typing import Any

_WS_RE = re.compile(r"\s+")

# Tipos suportados pelo runner do backend (internal/workflows/domain/graph.go).
ALLOWED_NODE_TYPES: set[str] = {
    "schedule",
    "goto",
    "click",
    "fill",
    "wait",
    "llm",
    "web_search",
    "send_email",
    "post_facebook",
    "post_instagram",
    "post_whatsapp",
    "post_linkedin",
    "post_x",
    "post_twitter",
    "post_youtube",
}

# Campos de NodeData relevantes por tipo (para mapear o blueprint → data).
_DATA_FIELDS: dict[str, tuple[str, ...]] = {
    "schedule": ("cron", "timezone", "schedule_enabled"),
    "goto": ("url",),
    "click": ("selector",),
    "fill": ("selector", "value"),
    "wait": ("selector", "timeout_ms"),
    "llm": ("prompt",),
    "web_search": ("query", "search_engine", "m"),
    "send_email": ("email_to", "contact_id", "email_subject", "email_body"),
    "post_facebook": ("caption", "image_url", "link_url"),
    "post_instagram": ("caption", "image_url"),
    "post_whatsapp": ("caption", "whatsapp_to", "image_url"),
    "post_linkedin": ("caption", "image_url", "link_url"),
    "post_x": ("caption", "image_url", "link_url"),
    "post_twitter": ("caption", "image_url", "link_url"),
    "post_youtube": ("caption", "video_url", "youtube_format"),
}

_GRID_X = 280
_GRID_Y = 140
_PER_ROW = 4


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip())


def parse_json_block(raw: str) -> dict[str, Any]:
    """Extrai um objecto JSON de uma resposta LLM, tolerando code fences."""
    s = (raw or "").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = (
                "\n".join(lines[1:-1])
                if lines[-1].strip().startswith("```")
                else "\n".join(lines[1:])
            )
            s = inner.strip()
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def normalize_brief(data: dict[str, Any], *, raw: str = "") -> dict[str, Any]:
    title = _norm(str(data.get("title") or data.get("name") or ""))[:120]
    description = _norm(str(data.get("description") or data.get("objective") or ""))[:1200]
    trigger = _norm(str(data.get("trigger") or "manual"))[:200]
    integrations = data.get("integrations")
    if not isinstance(integrations, list):
        integrations = []
    clean_integrations = [_norm(str(x)) for x in integrations if _norm(str(x))][:12]
    assumptions = data.get("assumptions")
    if not isinstance(assumptions, list):
        assumptions = []
    clean_assumptions = [_norm(str(x)) for x in assumptions if _norm(str(x))][:8]
    if not description:
        description = _norm(raw)[:1200]
    if not title:
        title = (description[:60] or "Automação").strip()
    return {
        "title": title,
        "description": description,
        "trigger": trigger,
        "integrations": clean_integrations,
        "assumptions": clean_assumptions,
    }


def _coerce_type(raw_type: str) -> str:
    t = _norm(raw_type).lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "navigate": "goto",
        "open_url": "goto",
        "open": "goto",
        "search": "web_search",
        "websearch": "web_search",
        "google": "web_search",
        "email": "send_email",
        "sendemail": "send_email",
        "mail": "send_email",
        "ai": "llm",
        "gpt": "llm",
        "model": "llm",
        "generate": "llm",
        "cron": "schedule",
        "trigger": "schedule",
        "facebook": "post_facebook",
        "instagram": "post_instagram",
        "whatsapp": "post_whatsapp",
        "linkedin": "post_linkedin",
        "twitter": "post_x",
        "x": "post_x",
        "youtube": "post_youtube",
    }
    t = aliases.get(t, t)
    return t if t in ALLOWED_NODE_TYPES else "llm"


def normalize_steps(raw_steps: Any) -> list[dict[str, Any]]:
    """Normaliza a lista de passos do LLM: tipos válidos, IDs únicos, prompt."""
    if not isinstance(raw_steps, list):
        return []
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(raw_steps[:30], start=1):
        if not isinstance(item, dict):
            continue
        node_type = _coerce_type(str(item.get("type") or ""))
        raw_id = _norm(str(item.get("id") or "")) or f"n{idx}"
        node_id = re.sub(r"[^a-zA-Z0-9_]", "_", raw_id) or f"n{idx}"
        while node_id in seen_ids:
            node_id = f"{node_id}_{idx}"
        seen_ids.add(node_id)

        label = _norm(str(item.get("label") or item.get("title") or node_type))[:80]
        prompt = _norm(str(item.get("prompt") or item.get("instruction") or ""))[:2000]
        rationale = _norm(str(item.get("rationale") or ""))[:600]

        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        step: dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "label": label,
            "prompt": prompt,
            "rationale": rationale,
        }
        # Recolhe campos específicos do tipo a partir de `data` ou do topo do item.
        for field in _DATA_FIELDS.get(node_type, ()):  # noqa: PLC0206
            value = data.get(field, item.get(field))
            if value is not None and value != "":
                step[field] = value
        out.append(step)
    return out


def steps_to_graph(steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Converte passos normalizados num GraphJSON (nodes + edges + posições)."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for i, step in enumerate(steps):
        node_type = step["type"]
        data: dict[str, Any] = {"label": step.get("label") or node_type}
        if step.get("prompt"):
            # O runner llm usa data.prompt; demais tipos guardam a instrução para a UI.
            data["prompt"] = step["prompt"]
        if step.get("rationale"):
            data["rationale"] = step["rationale"]
        for field in _DATA_FIELDS.get(node_type, ()):  # noqa: PLC0206
            if field in step:
                data[field] = step[field]
        # web_search usa data.query (não prompt); mapeia se faltar.
        if node_type == "web_search" and "query" not in data and step.get("prompt"):
            data["query"] = step["prompt"][:200]
        nodes.append(
            {
                "id": step["id"],
                "type": node_type,
                "position": {
                    "x": float((i % _PER_ROW) * _GRID_X),
                    "y": float((i // _PER_ROW) * _GRID_Y),
                },
                "data": data,
            }
        )
        if i > 0:
            edges.append(
                {
                    "id": f"e{i}",
                    "source": steps[i - 1]["id"],
                    "target": step["id"],
                }
            )
    return {"nodes": nodes, "edges": edges}


def validate_graph(graph: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Valida e corrige levemente o grafo: IDs únicos e arestas coerentes."""
    notes: list[str] = []
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), list) else []
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []

    valid_ids: set[str] = set()
    clean_nodes: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = str(node.get("id") or "")
        if not nid or nid in valid_ids:
            notes.append(f"Nó ignorado (ID inválido/duplicado): {nid!r}")
            continue
        if node.get("type") not in ALLOWED_NODE_TYPES:
            notes.append(f"Tipo de nó não suportado convertido para llm: {node.get('type')!r}")
            node = {**node, "type": "llm"}
        valid_ids.add(nid)
        clean_nodes.append(node)

    clean_edges: list[dict[str, Any]] = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        src = str(edge.get("source") or "")
        tgt = str(edge.get("target") or "")
        if src in valid_ids and tgt in valid_ids and src != tgt:
            clean_edges.append(edge)
        else:
            notes.append(f"Aresta removida (extremo inválido): {src}→{tgt}")

    return {"nodes": clean_nodes, "edges": clean_edges}, notes


def graph_to_raw_json(graph: dict[str, Any]) -> str:
    return json.dumps(graph, ensure_ascii=False)
