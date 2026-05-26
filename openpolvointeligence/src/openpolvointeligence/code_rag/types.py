"""Tipos partilhados do Code RAG."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ChunkType = Literal["config", "route", "component", "function", "hook", "module", "type"]
LayerHint = Literal["frontend", "backend", "shared"]

CONFIG_PATH_PATTERNS = (
    "package.json",
    "tsconfig",
    "vite.config",
    "next.config",
    "angular.json",
    "go.mod",
    ".env",
    "middleware.ts",
    "middleware.js",
    "auth.config",
    "nextauth",
    "supabase",
    "docker-compose",
    "tailwind.config",
    "eslint.config",
    "prisma/schema",
)

ROUTE_PATH_PATTERNS = (
    "/routes/",
    "/router/",
    "app.routes",
    "routes.ts",
    "routes.tsx",
    "route.ts",
    "route.tsx",
    "/api/",
    "handlers/",
    "internal/transport/http/",
    "cmd/",
)

SKIP_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    "vendor",
}

SKIP_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".zip",
    ".lock",
}


@dataclass
class CodeChunk:
    path: str
    chunk_type: ChunkType
    symbol_name: str | None
    start_line: int
    end_line: int
    layer: LayerHint
    content: str
    content_hash: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def embed_text(self) -> str:
        """Texto enviado ao modelo de embedding."""
        sym = f" symbol={self.symbol_name}" if self.symbol_name else ""
        meta = self.metadata
        extra = ""
        if meta.get("routes"):
            extra += f"\nroutes: {', '.join(meta['routes'][:8])}"
        if meta.get("exports"):
            extra += f"\nexports: {', '.join(meta['exports'][:8])}"
        return (
            f"path: {self.path}\n"
            f"type: {self.chunk_type}\n"
            f"layer: {self.layer}{sym}\n"
            f"lines: {self.start_line}-{self.end_line}"
            f"{extra}\n\n"
            f"{self.content[:2400]}"
        )


@dataclass
class RetrievedChunk:
    path: str
    chunk_type: ChunkType
    symbol_name: str | None
    layer: LayerHint
    score: float
    excerpt: str
    start_line: int
    end_line: int
    metadata: dict[str, Any] = field(default_factory=dict)
