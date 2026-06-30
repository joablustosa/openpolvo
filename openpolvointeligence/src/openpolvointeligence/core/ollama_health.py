"""Verificação de disponibilidade do Ollama (com cache curto para não bloquear cada chamada LLM)."""

from __future__ import annotations

import time
from typing import Any

import httpx

_CACHE_TTL_S = 30.0
_reach_cache: dict[str, tuple[float, bool]] = {}
_model_cache: dict[str, tuple[float, bool]] = {}


def _cache_get(cache: dict[str, tuple[float, bool]], key: str) -> bool | None:
    entry = cache.get(key)
    if entry is None:
        return None
    if (time.monotonic() - entry[0]) >= _CACHE_TTL_S:
        return None
    return entry[1]


def _cache_set(cache: dict[str, tuple[float, bool]], key: str, ok: bool) -> None:
    cache[key] = (time.monotonic(), ok)


def is_ollama_reachable(base_url: str, *, timeout_s: float = 2.0) -> bool:
    """True se o endpoint Ollama responde (serviço a correr)."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return False
    cached = _cache_get(_reach_cache, base)
    if cached is not None:
        return cached
    ok = False
    try:
        with httpx.Client(timeout=timeout_s) as client:
            r = client.get(f"{base}/api/tags")
            ok = r.status_code < 500
    except httpx.HTTPError:
        ok = False
    _cache_set(_reach_cache, base, ok)
    return ok


def is_ollama_model_available(
    base_url: str,
    model: str,
    *,
    timeout_s: float = 2.0,
) -> bool:
    """True se o serviço responde e o modelo pedido está na lista de tags."""
    base = (base_url or "").strip().rstrip("/")
    want = (model or "").strip()
    if not base or not want:
        return False
    cache_key = f"{base}|{want}"
    cached = _cache_get(_model_cache, cache_key)
    if cached is not None:
        return cached
    ok = False
    try:
        with httpx.Client(timeout=timeout_s) as client:
            r = client.get(f"{base}/api/tags")
            if r.status_code >= 500:
                ok = False
            else:
                payload: dict[str, Any] = r.json()
                names = [
                    str(m.get("name") or "").split(":")[0]
                    for m in payload.get("models") or []
                    if isinstance(m, dict)
                ]
                ok = want in names or any(want in n for n in names)
    except (httpx.HTTPError, ValueError, TypeError):
        ok = False
    _cache_set(_model_cache, cache_key, ok)
    return ok


async def is_ollama_reachable_async(base_url: str, *, timeout_s: float = 2.0) -> bool:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return False
    cached = _cache_get(_reach_cache, base)
    if cached is not None:
        return cached
    ok = False
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(f"{base}/api/tags")
            ok = r.status_code < 500
    except httpx.HTTPError:
        ok = False
    _cache_set(_reach_cache, base, ok)
    return ok


def is_ollama_usable(
    base_url: str,
    model: str,
    *,
    timeout_s: float = 2.0,
    enabled: bool = True,
) -> bool:
    """Ollama configurado = activo, serviço acessível e modelo presente."""
    if not enabled:
        return False
    if not is_ollama_reachable(base_url, timeout_s=timeout_s):
        return False
    return is_ollama_model_available(base_url, model, timeout_s=timeout_s)
