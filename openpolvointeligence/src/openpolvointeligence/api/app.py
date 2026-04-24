from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from openpolvointeligence import __version__
from openpolvointeligence.api.routes import router as v1_router
from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.zepolvinho_graph import get_compiled_graph


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    # Pré-compila o grafo no arranque (falha cedo se prompts em falta).
    get_compiled_graph(settings)
    yield


app = FastAPI(
    title="Open Polvo Intelligence",
    version=__version__,
    lifespan=lifespan,
)
app.include_router(v1_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, str]:
    # Chaves LLM podem vir só no corpo do pedido (SQLite local via API Go).
    return {"status": "ready"}
