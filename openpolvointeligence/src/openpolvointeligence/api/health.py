from __future__ import annotations

import httpx
from fastapi import HTTPException

from openpolvointeligence.core.config import get_settings


async def check_ollama_reachable(base_url: str) -> bool:
    url = base_url.rstrip("/") + "/api/tags"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            return r.status_code == 200
    except httpx.HTTPError:
        return False


async def readyz_payload() -> dict[str, str]:
    settings = get_settings()
    if settings.has_any_llm_key:
        ollama_ok = await check_ollama_reachable(settings.ollama_base_url)
        if ollama_ok:
            return {"status": "ready", "ollama": "ok"}
        # Cloud keys may still work without Ollama.
        if (settings.openai_api_key or "").strip() or (settings.google_api_key or "").strip():
            return {"status": "ready", "ollama": "unreachable"}
        raise HTTPException(status_code=503, detail="ollama unreachable")
    raise HTTPException(status_code=503, detail="no LLM configured")
