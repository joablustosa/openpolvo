"""Symbol Graph em memória."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from openpolvointeligence.graphs.dev_workflow.engines.ast.parser import extract_symbols


@dataclass
class SymbolGraph:
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    edges: list[tuple[str, str, str]] = field(default_factory=list)

    def index_files(self, files: dict[str, str]) -> None:
        for path, content in files.items():
            for sym in extract_symbols(path, content):
                key = f"{path}::{sym['name']}"
                self.nodes[key] = sym
                self.edges.append((path, key, "defines"))

    def impact_of_path(self, path: str) -> list[str]:
        return sorted(
            {
                e[1].split("::")[0]
                for e in self.edges
                if e[0] == path or e[1].startswith(f"{path}::")
            }
        )

    def to_dict(self) -> dict[str, Any]:
        return {"nodes": self.nodes, "edges": self.edges}


def build_symbol_graph_from_state(state: dict[str, Any]) -> SymbolGraph:
    files = dict(state.get("project_files") or {})
    for w in state.get("pending_writes") or []:
        if isinstance(w, dict) and w.get("op") == "write" and w.get("path"):
            files[str(w["path"])] = str(w.get("content") or "")
    g = SymbolGraph()
    g.index_files(files)
    return g
