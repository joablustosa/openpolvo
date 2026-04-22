"""Formatação do contexto de finanças pessoais (API Go) para o prompt do especialista."""

from __future__ import annotations

import json
from typing import Any


def format_finance_for_prompt(finance_raw: dict[str, Any] | None) -> str:
    if not finance_raw or not isinstance(finance_raw, dict):
        return ""
    try:
        clip = json.dumps(finance_raw, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        return ""
    max_len = 12000
    if len(clip) > max_len:
        clip = clip[:max_len] + "\n… (truncado)"
    return clip
