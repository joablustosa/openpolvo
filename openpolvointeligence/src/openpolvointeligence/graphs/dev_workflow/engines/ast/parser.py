"""AST Engine — parse multi-linguagem (Python nativo + heurística TS)."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class AstSymbol:
    name: str
    kind: str
    path: str
    line: int


def parse_python_symbols(path: str, content: str) -> list[AstSymbol]:
    out: list[AstSymbol] = []
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return out
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            out.append(AstSymbol(node.name, "function", path, node.lineno))
        elif isinstance(node, ast.ClassDef):
            out.append(AstSymbol(node.name, "class", path, node.lineno))
        elif isinstance(node, ast.AsyncFunctionDef):
            out.append(AstSymbol(node.name, "async_function", path, node.lineno))
    return out


_TS_EXPORT = re.compile(
    r"export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)"
)


def parse_ts_symbols(path: str, content: str) -> list[AstSymbol]:
    out: list[AstSymbol] = []
    for i, line in enumerate(content.splitlines(), 1):
        m = _TS_EXPORT.search(line)
        if m:
            kind = "export"
            if "function" in line:
                kind = "function"
            elif "class" in line:
                kind = "class"
            elif "interface" in line:
                kind = "interface"
            out.append(AstSymbol(m.group(1), kind, path, i))
    return out


def extract_symbols(path: str, content: str) -> list[dict[str, Any]]:
    p = path.lower()
    if p.endswith(".py"):
        syms = parse_python_symbols(path, content)
    elif p.endswith((".ts", ".tsx", ".js", ".jsx")):
        syms = parse_ts_symbols(path, content)
    else:
        return []
    return [{"name": s.name, "kind": s.kind, "path": s.path, "line": s.line} for s in syms]
