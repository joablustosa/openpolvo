"""Porta de terminal do DevAgent — bridge desktop, memória ou sandbox."""

from __future__ import annotations

import asyncio
import re
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.desk.desk_tool_logic import (
    dispatch_tool_calls,
    execute_tool_local,
    format_tool_result,
)
from openpolvointeligence.graphs.dev_workflow.tools.filesystem import (
    grep_in_memory,
    list_files_in_memory,
    read_file,
)

TerminalMode = Literal["bridge", "memory", "sandbox"]
ToolEventEmitter = Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class TerminalResult:
    ok: bool
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    mode: TerminalMode = "memory"

    def output(self) -> str:
        return (self.stdout or self.stderr or "").strip()


@dataclass
class DevTerminalPort:
    settings: Settings
    workspace_path: str
    conversation_id: str | None
    project_files: dict[str, str]
    bridge_wait: Callable[[str, str, dict[str, Any], float], Awaitable[dict[str, Any]]] | None = (
        None
    )
    emit: ToolEventEmitter | None = None
    mode: TerminalMode = "memory"

    async def run(self, command: str, *, cwd: str | None = None) -> TerminalResult:
        cmd = command.strip()
        if not cmd:
            return TerminalResult(ok=False, exit_code=1, stderr="empty_command", mode=self.mode)
        wp = cwd or self.workspace_path
        if self.mode == "bridge" and self.bridge_wait and self.conversation_id and wp:
            return await self._run_bridge("terminal_run", {"command": cmd}, wp)
        if wp and (self.settings.desk_tools_local or self.mode == "sandbox"):
            # subprocess síncrono num thread — nunca bloquear o event loop (SSE/heartbeat).
            return await asyncio.to_thread(self._run_local, cmd, wp)
        return self._run_memory_command(cmd)

    async def git_status(self) -> TerminalResult:
        if self.mode == "bridge" and self.bridge_wait and self.conversation_id:
            return await self._run_bridge("git_status", {}, self.workspace_path)
        return TerminalResult(
            ok=True,
            stdout=self._memory_git_status(),
            mode=self.mode,
        )

    async def git_diff(self, rel_path: str = "") -> TerminalResult:
        if self.mode == "bridge" and self.bridge_wait and self.conversation_id:
            args: dict[str, Any] = {}
            if rel_path:
                args["rel_path"] = rel_path
            return await self._run_bridge("git_diff", args, self.workspace_path)
        return TerminalResult(ok=True, stdout="", mode=self.mode)

    async def git_commit(self, message: str) -> TerminalResult:
        if not message.strip():
            return TerminalResult(ok=False, exit_code=1, stderr="empty_commit_message")
        if not getattr(self.settings, "dev_workflow_auto_commit", True):
            return TerminalResult(ok=True, stdout="auto_commit_disabled", mode=self.mode)
        if self.mode == "bridge" and self.bridge_wait and self.conversation_id:
            return await self._run_bridge(
                "git_commit",
                {"message": message},
                self.workspace_path,
            )
        return TerminalResult(ok=True, stdout="git_commit_skipped_no_bridge", mode=self.mode)

    def grep(self, pattern: str, globs: list[str] | None = None) -> str:
        return grep_in_memory(self.project_files, pattern, globs=globs)

    def find_files(self, prefix: str = "src", limit: int = 200) -> str:
        return list_files_in_memory(self.project_files, prefix=prefix, limit=limit)

    def read(self, path: str) -> str:
        return read_file(self.project_files, path) or ""

    async def _run_bridge(
        self,
        tool: str,
        args: dict[str, Any],
        workspace_path: str,
    ) -> TerminalResult:
        assert self.bridge_wait is not None
        call_id = str(uuid.uuid4())
        results = await dispatch_tool_calls(
            self.settings,
            tool_calls=[{"id": call_id, "name": tool, "args": args}],
            workspace_path=workspace_path,
            conversation_id=self.conversation_id or "",
            bridge_wait=self.bridge_wait,
            emit=self.emit,
            use_local=False,
        )
        raw = results[0] if results else {}
        content = str(raw.get("content") or "")
        ok = "error" not in content.lower()[:200]
        return TerminalResult(
            ok=ok,
            exit_code=0 if ok else 1,
            stdout=content[:8000],
            mode="bridge",
        )

    def _run_local(self, command: str, workspace_path: str) -> TerminalResult:
        result = execute_tool_local(
            self.settings,
            tool_name="terminal_run",
            args={"command": command},
            workspace_path=workspace_path,
        )
        text = format_tool_result(result)[:8000]
        ok = bool(result.get("ok"))
        return TerminalResult(
            ok=ok,
            exit_code=0 if ok else int(result.get("exit_code") or 1),
            stdout=text,
            mode="sandbox",
        )

    def _run_memory_command(self, command: str) -> TerminalResult:
        cmd = command.strip()
        if cmd.startswith("cat "):
            path = cmd[4:].strip().split()[0]
            body = self.read(path)
            return TerminalResult(ok=bool(body), stdout=body, mode="memory")
        if "package.json" in cmd and "package.json" in self.project_files:
            return TerminalResult(
                ok=True,
                stdout=self.project_files.get("package.json", ""),
                mode="memory",
            )
        if cmd.startswith("find ") or "find " in cmd:
            m = re.search(r"find\s+(\S+)", cmd)
            prefix = m.group(1) if m else "src"
            if prefix.endswith("/src"):
                prefix = "src"
            return TerminalResult(ok=True, stdout=self.find_files(prefix), mode="memory")
        return TerminalResult(
            ok=True,
            stdout="(memory mode — comando não simulado)",
            mode="memory",
        )

    def _memory_git_status(self) -> str:
        n = len(self.project_files)
        return f"?? {n} files in-memory\n"


_port_var: ContextVar[DevTerminalPort | None] = ContextVar("dev_terminal_port", default=None)


def set_terminal_port(port: DevTerminalPort | None) -> Token[DevTerminalPort | None]:
    return _port_var.set(port)


def reset_terminal_port(token: Token[DevTerminalPort | None]) -> None:
    _port_var.reset(token)


def get_terminal_port() -> DevTerminalPort | None:
    return _port_var.get()


def resolve_terminal_mode(
    settings: Settings,
    *,
    workspace_path: str | None,
    conversation_id: str | None,
) -> TerminalMode:
    if settings.desk_tools_local and workspace_path:
        return "sandbox"
    if getattr(settings, "dev_workflow_terminal_local", True) and workspace_path:
        return "sandbox"
    if conversation_id and workspace_path:
        return "bridge"
    return "memory"


def build_terminal_port(
    settings: Settings,
    state: dict[str, Any],
    *,
    bridge_wait: Callable[[str, str, dict[str, Any], float], Awaitable[dict[str, Any]]] | None,
    emit: ToolEventEmitter | None,
) -> DevTerminalPort:
    from openpolvointeligence.graphs.dev_workflow.core.dev_workflow_request_kind import (
        create_project_for_kind,
    )
    from openpolvointeligence.graphs.dev_workflow.project_root_ops import (
        resolve_effective_workspace_path,
    )

    wp = str(state.get("workspace_path") or state.get("workspace_id") or "").strip()
    kind = str(state.get("request_kind") or "")
    has_ws = bool(wp) or bool(state.get("project_files"))
    create = create_project_for_kind(kind, has_workspace=has_ws) if kind else False
    effective_wp = resolve_effective_workspace_path(state, create_project=create) or wp
    cid = str(state.get("conversation_id") or "").strip() or None
    mode = resolve_terminal_mode(settings, workspace_path=effective_wp or None, conversation_id=cid)
    return DevTerminalPort(
        settings=settings,
        workspace_path=effective_wp,
        conversation_id=cid,
        project_files=dict(state.get("project_files") or {}),
        bridge_wait=bridge_wait,
        emit=emit,
        mode=mode,
    )
