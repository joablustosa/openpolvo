"""Extracção de chunks do repositório (zero embedding — só parsing)."""

from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Iterator

from openpolvointeligence.code_rag.types import (
    CONFIG_PATH_PATTERNS,
    ROUTE_PATH_PATTERNS,
    SKIP_DIRS,
    SKIP_EXTENSIONS,
    ChunkType,
    CodeChunk,
    LayerHint,
)
from openpolvointeligence.graphs.dev_workflow_context_manager import extract_file_structure
from openpolvointeligence.graphs.dev_workflow_state import content_sha256, infer_lang

MAX_FILE_BYTES = 64_000
MAX_CHUNKS_PER_FILE = 12
INDEXABLE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".go",
    ".json",
    ".md",
    ".css",
    ".html",
    ".vue",
    ".py",
    ".sql",
    ".yaml",
    ".yml",
    ".toml",
}


def _normalize_path(path: str) -> str:
    return path.replace("\\", "/").lstrip("/")


def _infer_layer(path: str) -> LayerHint:
    p = path.lower()
    if any(x in p for x in ("/api/", "internal/", "cmd/", ".go", "handlers/", "routes.go")):
        return "backend"
    if any(x in p for x in (".tsx", ".jsx", "components/", "pages/", "app/", "src/")):
        return "frontend"
    return "shared"


def _infer_chunk_type(path: str, content: str) -> ChunkType:
    pl = path.lower()
    if any(pat in pl for pat in CONFIG_PATH_PATTERNS):
        return "config"
    if any(pat in pl for pat in ROUTE_PATH_PATTERNS):
        return "route"
    if "route.ts" in pl or "route.tsx" in pl or re.search(r"router\.(get|post|put|delete)", content, re.I):
        return "route"
    if pl.endswith((".tsx", ".jsx")) and (
        "export default function" in content
        or "export function" in content
        or re.search(r"export\s+(?:const|function)\s+\w+", content)
    ):
        if re.search(r"use[A-Z]\w+", content):
            return "hook"
        return "component"
    if re.search(r"export\s+(?:type|interface)\s+\w+", content):
        return "type"
    return "module"


def _line_range_excerpt(content: str, start: int, end: int, max_chars: int = 1800) -> str:
    lines = content.splitlines()
    start_i = max(0, start - 1)
    end_i = min(len(lines), end)
    chunk = "\n".join(f"{i + 1:4d}| {lines[i]}" for i in range(start_i, end_i))
    return chunk[:max_chars]


def _find_function_blocks(content: str, lang: str) -> list[tuple[str, int, int]]:
    """Devolve (symbol_name, start_line, end_line) aproximados."""
    blocks: list[tuple[str, int, int]] = []
    lines = content.splitlines()

    if lang in ("ts", "tsx", "js", "jsx"):
        patterns = [
            r"export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)",
            r"export\s+const\s+(\w+)\s*=",
            r"export\s+function\s+(\w+)",
            r"(?:async\s+)?function\s+(\w+)\s*\(",
        ]
        for i, line in enumerate(lines):
            for pat in patterns:
                m = re.search(pat, line)
                if not m:
                    continue
                name = m.group(1)
                end = min(len(lines), i + 80)
                for j in range(i + 1, min(len(lines), i + 120)):
                    if lines[j].strip() == "}" and j > i + 2:
                        end = j + 1
                        break
                blocks.append((name, i + 1, end))
                break

    if lang == "go":
        for i, line in enumerate(lines):
            m = re.match(r"func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(", line)
            if m:
                end = min(len(lines), i + 100)
                blocks.append((m.group(1), i + 1, end))

    return blocks[:MAX_CHUNKS_PER_FILE]


def chunk_file(path: str, content: str) -> list[CodeChunk]:
    """Divide um ficheiro em chunks indexáveis."""
    path = _normalize_path(path)
    if len(content.encode("utf-8")) > MAX_FILE_BYTES:
        content = content[:MAX_FILE_BYTES]

    lang = infer_lang(path)
    layer = _infer_layer(path)
    base_type = _infer_chunk_type(path, content)
    structure = extract_file_structure(path, content)
    meta_base = {
        "routes": structure.get("routes") or [],
        "exports": structure.get("exports") or [],
        "signatures": structure.get("signatures") or [],
    }

    chunks: list[CodeChunk] = []

    # Config / route: chunk único por ficheiro (prioridade RAG)
    if base_type in ("config", "route"):
        excerpt = _line_range_excerpt(content, 1, min(120, len(content.splitlines())))
        body = excerpt
        chunks.append(
            CodeChunk(
                path=path,
                chunk_type=base_type,
                symbol_name=None,
                start_line=1,
                end_line=min(120, len(content.splitlines())),
                layer=layer,
                content=body,
                content_hash=content_sha256(body),
                metadata=meta_base,
            ),
        )
        return chunks

    # Componentes / hooks — bloco principal + funções exportadas
    blocks = _find_function_blocks(content, lang)
    if blocks:
        for name, start, end in blocks[:MAX_CHUNKS_PER_FILE]:
            excerpt = _line_range_excerpt(content, start, end)
            ctype: ChunkType = "hook" if name.startswith("use") and name[3:4].isupper() else "function"
            if base_type == "component" and start <= 30:
                ctype = "component"
            chunks.append(
                CodeChunk(
                    path=path,
                    chunk_type=ctype,
                    symbol_name=name,
                    start_line=start,
                    end_line=end,
                    layer=layer,
                    content=excerpt,
                    content_hash=content_sha256(excerpt),
                    metadata=meta_base,
                ),
            )
    else:
        excerpt = _line_range_excerpt(content, 1, min(80, len(content.splitlines())))
        chunks.append(
            CodeChunk(
                path=path,
                chunk_type=base_type if base_type != "module" else "module",
                symbol_name=None,
                start_line=1,
                end_line=min(80, len(content.splitlines())),
                layer=layer,
                content=excerpt,
                content_hash=content_sha256(excerpt),
                metadata=meta_base,
            ),
        )

    return chunks


def should_index_path(path: str) -> bool:
    path = _normalize_path(path)
    parts = PurePosixPath(path).parts
    if any(p in SKIP_DIRS for p in parts):
        return False
    suffix = PurePosixPath(path).suffix.lower()
    if suffix in SKIP_EXTENSIONS:
        return False
    if suffix and suffix not in INDEXABLE_EXTENSIONS and not any(
        pat in path.lower() for pat in CONFIG_PATH_PATTERNS
    ):
        return False
    return True


def chunk_project_files(files: dict[str, str]) -> list[CodeChunk]:
    """Varre mapa path→conteúdo e gera todos os chunks."""
    all_chunks: list[CodeChunk] = []
    for raw_path, content in sorted(files.items()):
        path = _normalize_path(raw_path)
        if not should_index_path(path):
            continue
        if not content:
            continue
        all_chunks.extend(chunk_file(path, content))
    return all_chunks


def iter_files_from_root(root: str) -> Iterator[tuple[str, str]]:
    """Varre diretório no disco (CLI)."""
    from pathlib import Path

    base = Path(root)
    if not base.is_dir():
        return
    for fp in base.rglob("*"):
        if not fp.is_file():
            continue
        rel = _normalize_path(str(fp.relative_to(base)))
        if not should_index_path(rel):
            continue
        try:
            raw = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if len(raw.encode("utf-8")) > MAX_FILE_BYTES:
            raw = raw[:MAX_FILE_BYTES]
        yield rel, raw
