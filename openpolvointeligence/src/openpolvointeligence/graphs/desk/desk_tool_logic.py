"""Lógica pura das tools Desk — schemas, sandbox de paths e execução local (M2)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Callable, Awaitable

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from openpolvointeligence.core.config import Settings

MAX_READ_BYTES = 2 * 1024 * 1024
MAX_WRITE_BYTES = 512 * 1024
TERMINAL_TIMEOUT_S = 60.0

SKIP_DIR_NAMES = frozenset(
    {"node_modules", ".git", ".hg", "dist", "build", ".next", ".turbo"},
)

TERMINAL_DENY_PATTERNS = (
    re.compile(r"\brm\s+-rf\b", re.I),
    re.compile(r"\bformat\b", re.I),
    re.compile(r"\bdel\s+/[fs]\b", re.I),
    re.compile(r"\bshutdown\b", re.I),
    re.compile(r"\breboot\b", re.I),
    re.compile(r"\bmkfs\b", re.I),
    re.compile(r"\bdd\s+if=", re.I),
)


class PathTraversalError(ValueError):
    pass


def normalize_rel_path(raw: str) -> str:
    s = str(raw or "").replace("\\", "/").strip().lstrip("/")
    parts = [p for p in s.split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise PathTraversalError("path_traversal")
    return "/".join(parts)


def resolve_under_workspace(workspace_path: str, rel_path: str = "") -> Path:
    root = Path(workspace_path).resolve()
    if not root.is_dir():
        raise ValueError("workspace_not_found")
    rel = normalize_rel_path(rel_path)
    target = (root / rel.replace("/", os.sep)).resolve() if rel else root
    if target != root and root not in target.parents:
        raise PathTraversalError("path_escape")
    return target


def _list_dir_local(workspace_path: str, rel_path: str = "") -> dict[str, Any]:
    target = resolve_under_workspace(workspace_path, rel_path)
    if not target.is_dir():
        return {"ok": False, "error": "not_a_directory"}
    entries: list[dict[str, Any]] = []
    try:
        for name in sorted(os.listdir(target)):
            if name in SKIP_DIR_NAMES:
                continue
            full = target / name
            rel = normalize_rel_path(
                str(full.relative_to(Path(workspace_path).resolve())).replace("\\", "/"),
            )
            entries.append(
                {
                    "name": name,
                    "relPath": rel,
                    "isDirectory": full.is_dir(),
                },
            )
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "entries": entries}


def _read_file_local(workspace_path: str, rel_path: str) -> dict[str, Any]:
    target = resolve_under_workspace(workspace_path, rel_path)
    if not target.is_file():
        return {"ok": False, "error": "not_a_file"}
    try:
        size = target.stat().st_size
        if size > MAX_READ_BYTES:
            return {"ok": False, "error": "file_too_large"}
        content = target.read_text(encoding="utf-8", errors="replace")
        return {"ok": True, "content": content}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def _write_file_local(workspace_path: str, rel_path: str, content: str) -> dict[str, Any]:
    if len(content.encode("utf-8")) > MAX_WRITE_BYTES:
        return {"ok": False, "error": "content_too_large"}
    try:
        target = resolve_under_workspace(workspace_path, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True}
    except (PathTraversalError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def _terminal_denied(command: str) -> bool:
    return any(p.search(command) for p in TERMINAL_DENY_PATTERNS)


def _terminal_run_local(workspace_path: str, command: str) -> dict[str, Any]:
    cmd = command.strip()
    if not cmd:
        return {"ok": False, "error": "empty_command"}
    if _terminal_denied(cmd):
        return {"ok": False, "error": "command_denied"}
    root = Path(workspace_path).resolve()
    if not root.is_dir():
        return {"ok": False, "error": "workspace_not_found"}
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=TERMINAL_TIMEOUT_S,
            encoding="utf-8",
            errors="replace",
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        if len(out) > 32_000:
            out = out[:32_000] + "\n… (truncado)"
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "output": out.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def _git_run(workspace_path: str, args: list[str]) -> dict[str, Any]:
    root = Path(workspace_path).resolve()
    if not (root / ".git").exists():
        return {"ok": False, "error": "not_a_git_repo"}
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=30.0,
            encoding="utf-8",
            errors="replace",
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        if len(out) > 48_000:
            out = out[:48_000] + "\n… (truncado)"
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "output": out.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def execute_tool_local(
    settings: Settings,
    *,
    tool_name: str,
    args: dict[str, Any],
    workspace_path: str,
) -> dict[str, Any]:
    """Executa tool no processo intelligence (testes / fallback local)."""
    name = tool_name.strip()
    wp = workspace_path.strip()
    if name == "filesystem_list":
        return _list_dir_local(wp, str(args.get("rel_path") or args.get("path") or ""))
    if name == "filesystem_read":
        rel = str(args.get("rel_path") or args.get("path") or "")
        return _read_file_local(wp, rel)
    if name == "filesystem_write":
        rel = str(args.get("rel_path") or args.get("path") or "")
        content = str(args.get("content") or "")
        return _write_file_local(wp, rel, content)
    if name == "terminal_run":
        return _terminal_run_local(wp, str(args.get("command") or ""))
    if name == "git_status":
        return _git_run(wp, ["status", "--short", "--branch"])
    if name == "git_diff":
        rel = str(args.get("rel_path") or args.get("path") or "").strip()
        git_args = ["diff", "--stat"]
        if rel:
            git_args.append(rel)
        return _git_run(wp, git_args)
    if name == "git_commit":
        if not settings.desk_git_allow_commit:
            return {"ok": False, "error": "git_commit_disabled"}
        message = str(args.get("message") or "").strip()
        if not message:
            return {"ok": False, "error": "commit_message_required"}
        return _git_run(wp, ["commit", "-m", message])
    if name == "echo_ping":
        return {"ok": True, "output": str(args.get("text") or "pong")}
    return {"ok": False, "error": f"unknown_tool:{name}"}


def format_tool_result(result: dict[str, Any]) -> str:
    if result.get("ok"):
        if "content" in result:
            return str(result["content"])
        if "entries" in result:
            return json.dumps(result["entries"], ensure_ascii=False, indent=2)
        if "output" in result:
            return str(result["output"])
        return json.dumps(result, ensure_ascii=False)
    err = result.get("error") or "tool_failed"
    return f"ERRO: {err}"


# ── Schemas LangChain (bind_tools) ───────────────────────────────────────────


class FsListArgs(BaseModel):
    rel_path: str = Field(default="", description="Caminho relativo dentro do workspace")


class FsReadArgs(BaseModel):
    rel_path: str = Field(description="Caminho relativo do ficheiro")


class FsWriteArgs(BaseModel):
    rel_path: str = Field(description="Caminho relativo do ficheiro")
    content: str = Field(description="Conteúdo UTF-8 a escrever")


class TerminalRunArgs(BaseModel):
    command: str = Field(description="Comando shell a executar no workspace")


class GitDiffArgs(BaseModel):
    rel_path: str = Field(default="", description="Ficheiro opcional para diff")


class GitCommitArgs(BaseModel):
    message: str = Field(description="Mensagem de commit")


def _stub_tool(name: str, **_kwargs: Any) -> str:
    return f"[{name}] delegado ao cliente"


def desk_langchain_tools() -> list[StructuredTool]:
    """Tools expostas ao LLM — execução real no nó `tools`."""
    return [
        StructuredTool.from_function(
            func=lambda rel_path="": _stub_tool("filesystem_list", rel_path=rel_path),
            name="filesystem_list",
            description="Lista ficheiros e pastas num caminho relativo do workspace.",
            args_schema=FsListArgs,
        ),
        StructuredTool.from_function(
            func=lambda rel_path: _stub_tool("filesystem_read", rel_path=rel_path),
            name="filesystem_read",
            description="Lê o conteúdo de um ficheiro relativo ao workspace.",
            args_schema=FsReadArgs,
        ),
        StructuredTool.from_function(
            func=lambda rel_path, content: _stub_tool(
                "filesystem_write",
                rel_path=rel_path,
                content=content,
            ),
            name="filesystem_write",
            description="Escreve conteúdo num ficheiro relativo ao workspace.",
            args_schema=FsWriteArgs,
        ),
        StructuredTool.from_function(
            func=lambda command: _stub_tool("terminal_run", command=command),
            name="terminal_run",
            description="Executa um comando shell no directório do workspace.",
            args_schema=TerminalRunArgs,
        ),
        StructuredTool.from_function(
            func=lambda: _stub_tool("git_status"),
            name="git_status",
            description="Mostra git status --short --branch do repositório.",
        ),
        StructuredTool.from_function(
            func=lambda rel_path="": _stub_tool("git_diff", rel_path=rel_path),
            name="git_diff",
            description="Mostra git diff --stat (opcionalmente de um ficheiro).",
            args_schema=GitDiffArgs,
        ),
        StructuredTool.from_function(
            func=lambda message: _stub_tool("git_commit", message=message),
            name="git_commit",
            description="Cria commit git (só se permitido pelo servidor).",
            args_schema=GitCommitArgs,
        ),
    ]


ToolEventEmitter = Callable[[str, dict[str, Any]], Awaitable[None] | None]


async def dispatch_tool_calls(
    settings: Settings,
    *,
    tool_calls: list[dict[str, Any]],
    workspace_path: str,
    conversation_id: str,
    bridge_wait: Callable[[str, str, dict[str, Any], float], Awaitable[dict[str, Any]]],
    emit: ToolEventEmitter | None = None,
    use_local: bool = False,
) -> list[dict[str, Any]]:
    """Executa tool calls e devolve ToolMessages serializados."""
    results: list[dict[str, Any]] = []
    for tc in tool_calls:
        call_id = str(tc.get("id") or uuid.uuid4())
        name = str(tc.get("name") or "")
        raw_args = tc.get("args") or {}
        args = raw_args if isinstance(raw_args, dict) else {}

        payload = {"id": call_id, "tool": name, "name": name, "args": args}
        if emit:
            await emit("tool_call", payload)

        if use_local or settings.desk_tools_local:
            result = execute_tool_local(
                settings, tool_name=name, args=args, workspace_path=workspace_path
            )
        else:
            result = await bridge_wait(
                conversation_id, call_id, {"tool": name, "args": args}, TERMINAL_TIMEOUT_S
            )

        if emit:
            await emit(
                "tool_result",
                {
                    "id": call_id,
                    "tool": name,
                    "ok": bool(result.get("ok")),
                    "output": format_tool_result(result)[:4000],
                },
            )

        results.append(
            {
                "tool_call_id": call_id,
                "name": name,
                "content": format_tool_result(result),
            },
        )
    return results
