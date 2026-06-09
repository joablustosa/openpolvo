"""Normalização de resultados de revisores LLM (times Dev Workflow)."""

from __future__ import annotations

import json
import re
from typing import Any


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = (
                "\n".join(parts[1:-1])
                if parts[-1].strip().startswith("```")
                else "\n".join(parts[1:])
            )
            return inner.strip()
    return s


def parse_review_response(raw: str) -> dict[str, Any]:
    """Normaliza JSON do revisor: {approved, score, issues[], guidance}."""
    raw = _strip_json_fence(raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\"approved\"[\s\S]*\}", raw)
        if not m:
            return {
                "approved": False,
                "score": 0.0,
                "issues": [{"message": "Resposta de revisão inválida"}],
                "guidance": "Reformule o artefacto conforme as regras do sistema.",
            }
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict):
        data = {}

    approved = bool(data.get("approved"))
    score_raw = data.get("score")
    try:
        score = float(score_raw) if score_raw is not None else (1.0 if approved else 0.0)
    except (TypeError, ValueError):
        score = 1.0 if approved else 0.0
    score = max(0.0, min(1.0, score))

    issues_raw = data.get("issues")
    issues: list[dict[str, Any]] = []
    if isinstance(issues_raw, list):
        for item in issues_raw[:12]:
            if isinstance(item, dict):
                issues.append(
                    {
                        "severity": str(item.get("severity") or "error")[:20],
                        "message": str(item.get("message") or "")[:400],
                        "field": str(item.get("field") or "")[:80],
                    },
                )
            elif item:
                issues.append({"severity": "error", "message": str(item)[:400], "field": ""})

    guidance = str(data.get("guidance") or "")[:2000]
    if not approved and not guidance and issues:
        guidance = "; ".join(i["message"] for i in issues[:4])

    return {
        "approved": approved,
        "score": score,
        "issues": issues,
        "guidance": guidance,
    }


def merge_review_issues(*issue_lists: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for lst in issue_lists:
        for item in lst or []:
            if isinstance(item, dict):
                msg = str(item.get("message") or "")
            else:
                msg = str(item)
            key = msg[:120]
            if key and key not in seen:
                seen.add(key)
                out.append(
                    item if isinstance(item, dict) else {"severity": "error", "message": msg},
                )
    return out[:12]
