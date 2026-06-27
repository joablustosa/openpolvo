from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from openpolvointeligence import __version__
from openpolvointeligence.api.health import readyz_payload
from openpolvointeligence.api.routes import router as v1_router
from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.desk.desk_graph import get_compiled_desk_graph
from openpolvointeligence.graphs.orchestrator.zepolvinho_graph import get_compiled_graph


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    get_compiled_graph(settings)
    get_compiled_desk_graph(settings)
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
    return await readyz_payload()
