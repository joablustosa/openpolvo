"""Execution Engine — paralelismo de passos independentes."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any


async def run_parallel_steps(
    tasks: dict[str, Callable[[], Awaitable[dict[str, Any]]]],
    *,
    max_concurrent: int = 2,
) -> dict[str, Any]:
    """Executa runners independentes em paralelo com limite."""
    sem = asyncio.Semaphore(max_concurrent)
    merged: dict[str, Any] = {}

    async def _run(key: str, fn: Callable[[], Awaitable[dict[str, Any]]]) -> None:
        async with sem:
            patch = await fn()
            if isinstance(patch, dict):
                merged.update(patch)

    await asyncio.gather(*[_run(k, fn) for k, fn in tasks.items()])
    return merged
