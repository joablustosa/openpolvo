"""Extrair URLs candidatas dos blocos SerpAPI para aprofundamento por site."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from openpolvointeligence.graphs.web_page_fetch import is_safe_public_http_url

_URL_RE = re.compile(r"https?://[^\s\)\]\"\'>]+", re.I)


def _normalize_url(u: str) -> str:
    return u.rstrip(".,;)]\"'").strip()


def _host_blocked_for_deep_fetch(host: str) -> bool:
    """Evita agregadores e redirectores; foca em domínios de conteúdo."""
    h = host.lower()
    if h.endswith(".google.com") or h.endswith(".google.pt"):
        return True
    if h.endswith(".gstatic.com") or h.endswith(".googleusercontent.com"):
        return True
    if h == "serpapi.com" or h.endswith(".serpapi.com"):
        return True
    if h.endswith(".bing.com") or h == "bing.com":
        return True
    return False


def pick_urls_for_deep_dive(
    snippet_blocks: list[str],
    *,
    max_urls: int = 4,
    max_per_host: int = 2,
) -> list[str]:
    """
    Escolhe até `max_urls` URLs http(s) distintas, com diversidade de host
    (evita 4 links todos do Google).
    """
    text = "\n".join(snippet_blocks or [])
    found = _URL_RE.findall(text)
    hosts_count: dict[str, int] = {}
    out: list[str] = []
    seen: set[str] = set()
    for raw in found:
        u = _normalize_url(raw)
        if not u or u in seen:
            continue
        if not is_safe_public_http_url(u):
            continue
        try:
            host = (urlparse(u).hostname or "").lower()
        except ValueError:
            continue
        if not host or _host_blocked_for_deep_fetch(host):
            continue
        n = hosts_count.get(host, 0)
        if n >= max_per_host:
            continue
        hosts_count[host] = n + 1
        seen.add(u)
        out.append(u)
        if len(out) >= max_urls:
            break
    return out
