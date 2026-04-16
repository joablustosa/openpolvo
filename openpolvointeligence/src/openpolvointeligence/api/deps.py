from __future__ import annotations

from fastapi import Header, HTTPException

from openpolvointeligence.core.config import get_settings


async def verify_internal_key(
    x_open_polvo_internal_key: str | None = Header(None, alias="X-Open-Polvo-Internal-Key"),
) -> None:
    s = get_settings()
    expected = (s.polvo_internal_key or "").strip()
    got = (x_open_polvo_internal_key or "").strip()
    if not expected or got != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
