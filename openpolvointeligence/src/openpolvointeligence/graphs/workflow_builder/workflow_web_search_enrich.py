"""Enriquecimento do nó web_search dos workflows: URLs SerpAPI → trafilatura + agente por site."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.web_research.site_research_subgraph import (
    build_site_research_graph,
)
from openpolvointeligence.graphs.web_research.web_url_extract import pick_urls_for_deep_dive

_logger = logging.getLogger(__name__)


async def run_workflow_web_search_enrich(
    settings: Settings,
    model_provider: str | None,
    *,
    query: str,
    organic: list[dict[str, Any]],
) -> str:
    """
    Escolhe URLs seguras a partir dos orgânicos SerpAPI, corre o sub-grafo por URL
    (fetch trafilatura + agente LLM) em paralelo e devolve Markdown para anexar à saída do nó.
    """
    block_lines: list[str] = []
    for row in organic:
        link = str(row.get("link") or "").strip()
        title = str(row.get("title") or "").strip()
        snip = str(row.get("snippet") or "").strip()
        if link:
            block_lines.append(f"{link} {title}\n{snip}")
    synthetic = "\n".join(block_lines)
    if not synthetic.strip():
        return "## Conteúdo extraído das páginas\n_(Sem URLs nos resultados orgânicos.)_"

    max_u = max(1, min(8, int(settings.web_research_max_deep_urls or 4)))
    urls = pick_urls_for_deep_dive([synthetic], max_urls=max_u, max_per_host=2)
    if not urls:
        return (
            "## Conteúdo extraído das páginas\n_(Nenhuma URL elegível para aprofundamento seguro.)_"
        )

    site_g = build_site_research_graph(settings)
    sem = asyncio.Semaphore(3)
    uq = (query or "").strip() or "pesquisa web (workflow)"

    async def run_one(u: str) -> str:
        async with sem:
            try:
                out = await site_g.ainvoke(
                    {
                        "url": u,
                        "user_query": uq,
                        "model_provider": model_provider,
                        "trace": [],
                    },
                )
                sm = str(out.get("site_summary") or "").strip()
                return f"### Site: `{u}`\n\n{sm}" if sm else ""
            except Exception as exc:
                _logger.warning("workflow web enrich fail %s: %s", u[:80], exc)
                return f"### Site: `{u}`\n\n_(Erro: {exc})_"

    parts = [p for p in await asyncio.gather(*[run_one(u) for u in urls]) if p]
    if not parts:
        return "## Conteúdo extraído das páginas\n_(Sem texto útil extraído das páginas.)_"
    return (
        "## Conteúdo extraído das páginas (trafilatura + agente de extração web)\n\n"
        + "\n\n---\n\n".join(parts)
    )
