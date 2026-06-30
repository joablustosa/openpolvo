"""Ferramentas do loop agentico — exploração e edição sobre project_files."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
    stable_project_id,
)
from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.patch import (
    apply_search_replace,
)
from openpolvointeligence.graphs.dev_workflow.tools.filesystem import (
    grep_in_memory,
    list_files_in_memory,
    read_file,
    write_file,
)
from openpolvointeligence.graphs.dev_workflow.tools.terminal_port import (
    DevTerminalPort,
)

MAX_READ_CHARS = 12_000
MAX_TOOL_OUTPUT = 8_000


async def execute_agent_tool(
    settings: Settings,
    state: dict[str, Any],
    tool: str,
    args: dict[str, Any],
    *,
    project_files: dict[str, str],
    port: DevTerminalPort | None,
) -> tuple[str, dict[str, str], list[dict[str, Any]]]:
    """Executa uma ferramenta. Devolve (observação, project_files actualizados, ops parciais)."""
    files = dict(project_files)
    ops: list[dict[str, Any]] = []
    name = (tool or "").strip().lower()
    a = args if isinstance(args, dict) else {}

    if name == "read_file":
        path = str(a.get("path") or "")
        content = read_file(files, path)
        if content is None and port:
            content = port.read(path) or ""
        if content is None:
            return f"Erro: ficheiro não encontrado: {path}", files, ops
        clipped = content[:MAX_READ_CHARS]
        suffix = "\n…(truncado)" if len(content) > MAX_READ_CHARS else ""
        return f"### {path}\n{clipped}{suffix}", files, ops

    if name == "grep":
        pattern = str(a.get("pattern") or a.get("query") or "")
        globs = a.get("globs")
        glob_list = globs if isinstance(globs, list) else None
        if port:
            out = port.grep(pattern, globs=glob_list)
        else:
            out = grep_in_memory(files, pattern, globs=glob_list)
        return (out or "(sem correspondências)")[:MAX_TOOL_OUTPUT], files, ops

    if name == "list_files":
        prefix = str(a.get("prefix") or a.get("path") or "src")
        if port:
            out = port.find_files(prefix, limit=200)
        else:
            out = list_files_in_memory(files, prefix=prefix)
        return out[:MAX_TOOL_OUTPUT] or "(vazio)", files, ops

    if name == "semantic_search":
        query = str(a.get("query") or a.get("pattern") or "")
        from openpolvointeligence.graphs.dev_workflow.dev_workflow_code_rag import (
            retrieve_for_architect,
        )

        block, paths = await retrieve_for_architect(
            settings,
            stable_project_id(state),
            query,
        )
        header = f"Paths: {', '.join(paths[:15])}\n\n" if paths else ""
        return (header + block)[:MAX_TOOL_OUTPUT] or "(sem resultados)", files, ops

    if name == "search_replace":
        path = str(a.get("path") or "")
        old_text = str(a.get("old_text") or "")
        new_text = str(a.get("new_text") or "")
        key = path.strip().replace("\\", "/").lstrip("/")
        updated, err = apply_search_replace(files, path, old_text, new_text)
        if err:
            return f"Erro search_replace: {err}", files, ops
        files = updated
        ops.append({"op": "write", "path": key, "content": files[key]})
        return f"OK: patch aplicado em {path}", files, ops

    if name == "write_file":
        path = str(a.get("path") or "")
        content = str(a.get("content") or "")
        key = path.strip().replace("\\", "/").lstrip("/")
        files = write_file(files, key, content)
        ops.append({"op": "write", "path": key, "content": content})
        return f"OK: escrito {key} ({len(content)} chars)", files, ops

    if name == "run_terminal":
        cmd = str(a.get("command") or a.get("cmd") or "")
        if not cmd:
            return "Erro: command vazio", files, ops
        if not port:
            return "Erro: terminal não disponível neste ambiente", files, ops
        result = await port.run(cmd)
        out = result.output()[:MAX_TOOL_OUTPUT]
        status = "OK" if result.ok else "FAIL"
        return f"[{status}] {out}", files, ops

    return f"Ferramenta desconhecida: {tool}", files, ops
