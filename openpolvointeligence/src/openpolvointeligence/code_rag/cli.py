#!/usr/bin/env python3
"""CLI — varre repositório, gera embeddings e grava em pgvector.

Exemplos:
  python -m openpolvointeligence.code_rag.cli index --project-id UUID --root ./meu-app
  python -m openpolvointeligence.code_rag.cli query --project-id UUID --prompt "NextAuth Supabase"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from openpolvointeligence.code_rag.indexer import index_project_from_disk, new_project_id
from openpolvointeligence.code_rag.retriever import build_rag_context_block, retrieve_for_router
from openpolvointeligence.core.config import get_settings


async def cmd_index(args: argparse.Namespace) -> int:
    settings = get_settings()
    pid = args.project_id or new_project_id()
    result = await index_project_from_disk(
        settings,
        pid,
        args.root,
        use_mock_embeddings=args.mock,
    )
    print(json.dumps(result.__dict__, indent=2, ensure_ascii=False))
    return 0


async def cmd_query(args: argparse.Namespace) -> int:
    settings = get_settings()
    chunks, paths = await retrieve_for_router(
        settings,
        args.project_id,
        args.prompt,
        top_k=args.top_k,
        use_mock=args.mock,
    )
    print(build_rag_context_block(chunks))
    print("\n--- paths ---")
    print(json.dumps(paths, indent=2, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open Polvo Code RAG")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_index = sub.add_parser("index", help="Indexar repositório")
    p_index.add_argument("--root", required=True, help="Raiz do projecto")
    p_index.add_argument("--project-id", help="UUID do projecto (gera se omitido)")
    p_index.add_argument("--mock", action="store_true", help="Embeddings mock (sem OpenAI)")
    p_index.set_defaults(func=cmd_index)

    p_query = sub.add_parser("query", help="Busca semântica (Router)")
    p_query.add_argument("--project-id", required=True)
    p_query.add_argument("--prompt", required=True)
    p_query.add_argument("--top-k", type=int, default=8)
    p_query.add_argument("--mock", action="store_true")
    p_query.set_defaults(func=cmd_query)

    args = parser.parse_args(argv)
    return asyncio.run(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
