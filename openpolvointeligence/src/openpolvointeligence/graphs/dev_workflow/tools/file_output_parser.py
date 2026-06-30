"""Parser %%FILE_START%% para output de agentes."""

from __future__ import annotations

import re
from typing import Any, Literal

FileAction = Literal["create", "edit", "delete"]


def parse_generated_files(llm_output: str) -> list[dict[str, Any]]:
    """Converte blocos %%FILE_START%% em operações pending_writes."""
    if "%%FILE_START%%" not in llm_output:
        return []
    blocks = llm_output.split("%%FILE_START%%")[1:]
    out: list[dict[str, Any]] = []
    for block in blocks:
        path_m = re.search(r"path:\s*(.+)", block)
        action_m = re.search(r"action:\s*(\w+)", block)
        content_m = re.search(
            r"%%CONTENT_START%%\s*([\s\S]*?)\s*%%CONTENT_END%%",
            block,
        )
        path = (path_m.group(1).strip() if path_m else "").strip()
        action = (action_m.group(1).strip() if action_m else "create").lower()
        content = content_m.group(1) if content_m else ""
        if not path:
            continue
        if action == "delete":
            out.append({"op": "delete", "path": path.replace("\\", "/")})
        else:
            out.append(
                {
                    "op": "write",
                    "path": path.replace("\\", "/"),
                    "content": content,
                },
            )
    return out


def ops_from_llm_output(raw: str, existing_ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fallback: JSON ops primeiro, depois %%FILE_START%%."""
    if existing_ops:
        return existing_ops
    return parse_generated_files(raw)
