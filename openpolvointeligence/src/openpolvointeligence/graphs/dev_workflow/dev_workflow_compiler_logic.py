"""Compiler_Checker — parse de logs WebContainer/Vite/tsc e contexto para self-healing."""

from __future__ import annotations

import json
import re
from typing import Any


def merge_compile_sources(
    preview_console_block: str | None,
    compile_log: str | None,
    preview_console_logs: list[dict[str, Any]] | None,
) -> str:
    """Junta todas as fontes de erro num único bloco (truncado)."""
    parts: list[str] = []
    if compile_log and compile_log.strip():
        parts.append(compile_log.strip()[:12_000])
    if preview_console_block and preview_console_block.strip():
        parts.append(preview_console_block.strip()[:8000])
    if preview_console_logs:
        lines: list[str] = []
        for row in preview_console_logs[:80]:
            if not isinstance(row, dict):
                continue
            lvl = str(row.get("level", "log")).lower()
            msg = str(row.get("message", "")).strip()
            if not msg:
                continue
            if lvl in ("error", "warn") or "error" in msg.lower() or "failed" in msg.lower():
                src = str(row.get("source", "") or "").strip()
                lines.append(f"[{lvl}] {msg}" + (f" @ {src}" if src else ""))
        if lines:
            parts.append("\n".join(lines)[:8000])
    return "\n\n---\n\n".join(parts)


def _parse_path_line_col(line: str) -> tuple[str | None, int | None, int | None]:
    """Extrai path:line:col de linhas estilo Vite/tsc/Go."""
    m = re.match(
        r"^(?P<path>(?:[\w./\\-]+/)?[\w.-]+\.(tsx?|jsx?|go|vue|css|json)):(?P<line>\d+)(?::(?P<col>\d+))?",
        line.strip(),
        re.I,
    )
    if m:
        return (
            m.group("path").replace("\\", "/"),
            int(m.group("line")),
            int(m.group("col")) if m.group("col") else None,
        )
    return None, None, None


def parse_compile_output(
    raw_log: str,
    max_errors: int = 10,
) -> tuple[bool, list[dict[str, Any]]]:
    """Reduz log de build a digests curtos."""
    if not raw_log.strip():
        return True, []

    errors: list[dict[str, Any]] = []
    seen: set[str] = set()

    for line in raw_log.splitlines():
        low = line.lower()
        if not any(
            k in low
            for k in (
                "error",
                "failed",
                "cannot find",
                "syntaxerror",
                "panic:",
                "module not found",
                "failed to resolve",
                "unexpected token",
                "does not provide an export named",
                "uncaught syntaxerror",
            )
        ):
            continue
        path, line_no, col = _parse_path_line_col(line)
        key = f"{path}:{line_no}:{line.strip()[:120]}"
        if key in seen:
            continue
        seen.add(key)
        code = "TS" if "ts" in low else "build"
        if "syntaxerror" in low:
            code = "syntax"
        errors.append(
            {
                "path": path,
                "line": line_no,
                "column": col,
                "code": code,
                "message": line.strip()[:320],
            },
        )
        if len(errors) >= max_errors:
            break

    ok = len(errors) == 0 and "error" not in raw_log.lower()[:800]
    return ok, errors


def pick_primary_error_file(
    errors: list[dict[str, Any]],
    project_files: dict[str, str] | None = None,
) -> str | None:
    """Ficheiro mais provável a corrigir (primeiro com path válido no projecto)."""
    files = project_files or {}
    norm_files = {k.replace("\\", "/"): k for k in files}
    for err in errors:
        p = str(err.get("path") or "").replace("\\", "/").lstrip("/")
        if not p:
            continue
        if p in files or p in norm_files:
            return p
        for fk in files:
            if fk.endswith(p) or p.endswith(fk):
                return fk.replace("\\", "/")
    for err in errors:
        p = str(err.get("path") or "").replace("\\", "/").lstrip("/")
        if p:
            return p
    return None


def build_error_file_excerpt(
    path: str,
    project_files: dict[str, str],
    errors: list[dict[str, Any]],
    *,
    context_lines: int = 20,
) -> str:
    """Excerpt numerado centrado na linha do erro principal."""
    body = project_files.get(path) or project_files.get(path.replace("/", "\\")) or ""
    if not body:
        return f"(ficheiro {path} não disponível no project_files)"

    lines = body.splitlines()
    target_line = 1
    for err in errors:
        if str(err.get("path", "")).replace("\\", "/").endswith(path.split("/")[-1]):
            if err.get("line"):
                target_line = int(err["line"])
                break

    start = max(0, target_line - 1 - context_lines)
    end = min(len(lines), target_line + context_lines)
    chunk = "\n".join(f"{i + 1:4d}| {lines[i]}" for i in range(start, end))
    return f"### {path} (erro ~linha {target_line})\n```\n{chunk}\n```"


def build_self_heal_human_message(
    *,
    error_digest: list[dict[str, Any]],
    compile_log: str,
    primary_file: str | None,
    project_files: dict[str, str],
    plan: dict[str, Any] | None,
    user_prompt: str,
) -> str:
    plan = plan or {}
    primary = primary_file or pick_primary_error_file(error_digest, project_files)
    excerpt = ""
    if primary:
        excerpt = build_error_file_excerpt(primary, project_files, error_digest)

    return (
        f"## Pedido original\n{user_prompt[:1500]}\n\n"
        f"## Erros de compilação (digest)\n{json.dumps(error_digest, ensure_ascii=False)}\n\n"
        f"## Log (truncado)\n{compile_log[:6000]}\n\n"
        f"## Ficheiro principal\n{primary or '(inferir do log)'}\n\n"
        f"## Excerpt numerado\n{excerpt}\n\n"
        f"## Plano actual (só corrigir o necessário)\n"
        f"targets: {json.dumps(plan.get('targets') or [], ensure_ascii=False)}\n"
        "Gera patches mínimos (op patch) para corrigir o build."
    )


def has_compile_errors_in_state(
    preview_console_block: str | None,
    compile_log: str | None,
    preview_console_logs: list[dict[str, Any]] | None,
) -> bool:
    merged = merge_compile_sources(preview_console_block, compile_log, preview_console_logs)
    if not merged.strip():
        return False
    ok, _ = parse_compile_output(merged)
    return not ok
