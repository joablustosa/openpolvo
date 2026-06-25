"""Lógica determinística do Prompt Improver do agente PDF."""

from __future__ import annotations

import json
import re
from typing import Any

_WS_RE = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip())


def parse_enriched_brief_json(raw: str) -> dict[str, Any]:
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
    if not isinstance(data, dict):
        data = {}
    return normalize_enriched_brief(data, raw=s)


def normalize_enriched_brief(data: dict[str, Any], *, raw: str = "") -> dict[str, Any]:
    objective = _norm(str(data.get("objective") or ""))
    audience = _norm(str(data.get("audience") or "decisores e equipas técnicas"))
    tone = _norm(str(data.get("tone") or "profissional"))
    if tone not in ("profissional", "executivo", "académico", "consultoria"):
        tone = "profissional"
    sections = data.get("sections")
    if not isinstance(sections, list) or not sections:
        sections = [
            "Resumo executivo",
            "Contexto e objetivos",
            "Metodologia",
            "Análise",
            "Conclusões",
            "Recomendações",
            "Revisão técnica",
        ]
    clean_sections = [_norm(str(x)) for x in sections if _norm(str(x))][:10]
    research_queries = data.get("research_queries")
    if not isinstance(research_queries, list):
        research_queries = []
    clean_queries: list[str] = []
    for q in research_queries[:6]:
        t = _norm(str(q))
        if t:
            clean_queries.append(t)
    full_prompt = _norm(str(data.get("full_prompt") or ""))
    if not full_prompt:
        full_prompt = _norm(raw) or objective
    if not objective:
        objective = full_prompt[:240] or "Estudo profissional solicitado pelo utilizador"
    return {
        "objective": objective,
        "audience": audience,
        "tone": tone,
        "sections": clean_sections,
        "research_queries": clean_queries,
        "full_prompt": full_prompt[:6000],
        "document_title": _norm(str(data.get("document_title") or objective))[:120],
    }


def format_brief_for_research(brief: dict[str, Any]) -> str:
    lines = [
        f"**Objetivo:** {brief.get('objective', '')}",
        f"**Público:** {brief.get('audience', '')}",
        f"**Tom:** {brief.get('tone', '')}",
        "**Secções planeadas:** " + ", ".join(brief.get("sections") or []),
    ]
    queries = brief.get("research_queries") or []
    if queries:
        lines.append("**Queries de pesquisa:** " + "; ".join(queries))
    return "\n".join(lines)
