"""Fetch HTTP de páginas públicas para aprofundar resultados SerpAPI (texto plano)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx

_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OpenPolvoResearch/1.0"
)


def is_safe_public_http_url(url: str) -> bool:
    """Evita SSRF óbvio (localhost, metadata, schemes inválidos)."""
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return False
    try:
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            return False
        host = (p.hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return False
    if host.endswith(".local"):
        return False
    if host.startswith("169.254."):
        return False
    return True


def strip_html_to_text(html: str, max_chars: int = 24_000) -> str:
    s = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    s = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", s)
    s = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", s)
    s = re.sub(r"(?is)<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= max_chars else s[: max_chars - 1] + "…"


async def fetch_url_plaintext(
    url: str,
    *,
    timeout_s: float = 18.0,
    max_bytes: int = 600_000,
    max_chars: int = 24_000,
) -> str:
    """GET da URL; devolve texto visível ou mensagem de erro curta."""
    u = (url or "").strip()
    if not is_safe_public_http_url(u):
        return "[URL não permitida para fetch automático]"
    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers={"User-Agent": _DEFAULT_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"},
        ) as client:
            resp = await client.get(u)
            resp.raise_for_status()
            raw = resp.content[:max_bytes]
            ct = (resp.headers.get("content-type") or "").lower()
        if "html" in ct or "xml" in ct or not ct:
            text = raw.decode("utf-8", errors="replace")
            return strip_html_to_text(text, max_chars=max_chars)
        return raw.decode("utf-8", errors="replace")[:max_chars]
    except Exception as exc:
        return f"[Não foi possível ler a página: {exc}]"
