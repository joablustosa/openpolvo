"""Executores server-side das tools de web (search + fetch) para os agentes.

Fonte única reutilizada pelo agente Desk (`graphs/desk`) e pelo loop de dev
(`graphs/dev_workflow/engines/agent_loop`). A execução é **server-side** (o
Intelligence tem a key SerpAPI e o httpx) — não passa pelo tool-bridge do cliente.

São ferramentas **read-only** e seguras: `web_fetch` respeita o guard SSRF
(`is_safe_public_http_url`) e ambas limitam resultados/caracteres. Provider-agnóstico:
funcionam igual com Ollama local ou com keys de provider (só `web_search` precisa de
`SERPAPI_API_KEY`; `web_fetch` não precisa de chave nenhuma).

Contrato de retorno normalizado:
- sucesso → ``{"ok": True, "content": <str>}``
- falha   → ``{"ok": False, "error": <code>, "hint"?: <str>}``
"""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.web_research.web_page_fetch import (
    fetch_url_plaintext,
    is_safe_public_http_url,
)
from openpolvointeligence.graphs.web_research.web_research_serpapi import (
    fetch_organic_snippets,
)

WEB_TOOL_NAMES = frozenset({"web_search", "web_fetch"})

_ALLOWED_ENGINES = frozenset({"duckduckgo", "google"})


def web_tools_enabled(settings: Settings) -> bool:
    return bool(getattr(settings, "web_tools_enabled", True))


async def run_web_search(
    settings: Settings,
    query: str,
    *,
    max_results: int | None = None,
    engine: str | None = None,
) -> dict[str, Any]:
    """Pesquisa web via SerpAPI. Requer `SERPAPI_API_KEY`."""
    if not web_tools_enabled(settings):
        return {
            "ok": False,
            "error": "web_tools_disabled",
            "hint": "OP_WEB_TOOLS_ENABLED=1 para ativar",
        }
    q = str(query or "").strip()
    if not q:
        return {"ok": False, "error": "empty_query", "hint": "fornece um termo de pesquisa"}
    api_key = (settings.serpapi_api_key or "").strip()
    if not api_key:
        return {
            "ok": False,
            "error": "web_search_unavailable",
            "hint": "configure SERPAPI_API_KEY para ativar a pesquisa web",
        }
    eng = str(engine or "duckduckgo").strip().lower()
    if eng not in _ALLOWED_ENGINES:
        eng = "duckduckgo"
    limit = max_results if isinstance(max_results, int) and max_results > 0 else None
    if limit is None:
        limit = int(getattr(settings, "web_search_max_results", 5) or 5)
    limit = max(1, min(limit, 10))
    try:
        markdown = await fetch_organic_snippets(
            api_key=api_key,
            query=q,
            engine=eng,
            kl=(settings.serpapi_ddg_kl or None),
            ddg_safe=int(settings.serpapi_ddg_safe or 0),
            max_results=limit,
        )
    except Exception as exc:  # noqa: BLE001 — falha externa vira valor acionável, nunca engolida
        return {"ok": False, "error": "web_search_failed", "hint": str(exc)[:300]}
    return {"ok": True, "content": markdown or "_Sem resultados._"}


async def run_web_fetch(settings: Settings, url: str) -> dict[str, Any]:
    """Lê o conteúdo de uma URL pública (texto principal). Não requer chave."""
    if not web_tools_enabled(settings):
        return {
            "ok": False,
            "error": "web_tools_disabled",
            "hint": "OP_WEB_TOOLS_ENABLED=1 para ativar",
        }
    u = str(url or "").strip()
    if not u:
        return {"ok": False, "error": "empty_url", "hint": "fornece uma URL http(s)"}
    if not is_safe_public_http_url(u):
        return {
            "ok": False,
            "error": "url_blocked",
            "hint": "só URLs http(s) públicas são permitidas (SSRF bloqueado)",
        }
    text = await fetch_url_plaintext(
        u,
        timeout_s=float(settings.web_fetch_timeout_s),
        max_bytes=int(settings.web_fetch_max_response_bytes),
        max_chars=int(settings.web_fetch_max_text_chars),
        use_trafilatura=bool(settings.web_fetch_use_trafilatura),
    )
    return {"ok": True, "content": f"### {u}\n{text}"}


async def run_web_tool(settings: Settings, *, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Dispatcher server-side por nome de tool. Usado pelo agente Desk."""
    a = args if isinstance(args, dict) else {}
    if name == "web_search":
        return await run_web_search(
            settings,
            str(a.get("query") or a.get("q") or ""),
            max_results=a.get("max_results") if isinstance(a.get("max_results"), int) else None,
            engine=a.get("engine") if isinstance(a.get("engine"), str) else None,
        )
    if name == "web_fetch":
        return await run_web_fetch(settings, str(a.get("url") or ""))
    return {"ok": False, "error": f"unknown_web_tool:{name}"}
