from __future__ import annotations

import os

import uvicorn


def main() -> None:
    from openpolvointeligence.core.config import get_settings

    s = get_settings()
    uvicorn.run(
        "openpolvointeligence.api.app:app",
        host=s.host,
        port=s.port,
        factory=False,
        reload=os.getenv("UVICORN_RELOAD", "").lower() in ("1", "true", "yes"),
    )


if __name__ == "__main__":
    main()
