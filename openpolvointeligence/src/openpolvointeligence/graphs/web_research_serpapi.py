"""Chamadas SerpAPI (DuckDuckGo / Google) para o pipeline de pesquisa web."""

from __future__ import annotations

import json
from typing import Any

import httpx


async def fetch_organic_snippets(
    *,
    api_key: str,
    query: str,
    engine: str,
    kl: str | None = None,
    ddg_safe: int = 0,
    max_results: int = 5,
    timeout_s: float = 25.0,
) -> str:
    """Executa uma pesquisa e devolve texto em Markdown (título, URL, snippet)."""
    q = (query or "").strip()
    if not q:
        return ""
    if len(q) > 500:
        q = q[:500]
    eng = (engine or "duckduckgo").strip().lower()
    if eng not in ("duckduckgo", "google"):
        eng = "duckduckgo"

    params: dict[str, Any] = {
        "engine": eng,
        "q": q,
        "api_key": api_key.strip(),
        "output": "json",
    }
    if eng == "duckduckgo":
        if kl and str(kl).strip():
            params["kl"] = str(kl).strip()
        if ddg_safe:
            params["safe"] = str(ddg_safe)
    elif eng == "google" and ddg_safe:
        params["safe"] = str(ddg_safe)

    url = "https://serpapi.com/search"
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        out = resp.json()

    meta = out.get("search_metadata") or {}
    if str(meta.get("status", "")).strip().lower() == "error" and meta.get("error"):
        raise RuntimeError(str(meta.get("error")))

    organic = out.get("organic_results") or []
    lines: list[str] = [f"### Motor: {eng} | query: {q}\n"]
    n = min(max_results, len(organic))
    if n == 0:
        lines.append("_Sem resultados orgânicos._\n")
        return "\n".join(lines)
    for i in range(n):
        row = organic[i] if isinstance(organic[i], dict) else {}
        title = str(row.get("title") or "").strip()
        link = str(row.get("link") or "").strip()
        snippet = str(row.get("snippet") or "").strip()
        lines.append(f"{i + 1}. **{title}**\n   - URL: {link}\n   - Resumo: {snippet}\n")
    related = out.get("related_searches") or []
    if isinstance(related, list) and related:
        qs = []
        for r in related[:4]:
            if isinstance(r, dict) and r.get("query"):
                qs.append(str(r["query"]).strip())
        if qs:
            lines.append("**Pesquisas relacionadas (SerpAPI):** " + "; ".join(qs))
    return "\n".join(lines)


def parse_plan_json(raw: str) -> dict[str, Any]:
    s = raw.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = "\n".join(lines[1:-1]) if lines[-1].strip().startswith("```") else "\n".join(lines[1:])
            s = inner.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {"queries": [{"q": s[:400] if s else "pesquisa", "engine": "duckduckgo"}]}
