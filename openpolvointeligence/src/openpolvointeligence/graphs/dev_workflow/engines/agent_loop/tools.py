"""Ferramentas do loop agentico — exploração, edição e verificação sobre project_files.

Todas as ferramentas operam sobre ``project_files`` em memória (o front aplica as
``polvo_code_ops`` no workspace real). ``execute_agent_tool`` mantém a assinatura
``(obs, project_files, ops_parciais)`` — o contrato consumido pelo loop.
"""

from __future__ import annotations

import fnmatch
import json
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


def _norm(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def _glob_in_memory(files: dict[str, str], pattern: str, *, limit: int = 200) -> list[str]:
    pat = _norm(pattern)
    # fnmatch não trata '**' como recursivo; normalizamos '**/' → '*' para casar em qualquer nível.
    simple = pat.replace("**/", "*/").replace("**", "*")
    out: list[str] = []
    for p in sorted(files):
        if fnmatch.fnmatch(p, simple) or fnmatch.fnmatch(p, pat) or ("**" in pat and _match_recursive(p, pat)):
            out.append(p)
            if len(out) >= limit:
                break
    return out


def _match_recursive(path: str, pattern: str) -> bool:
    # Suporte simples a 'dir/**/*.ext'
    if "**" not in pattern:
        return fnmatch.fnmatch(path, pattern)
    prefix, _, suffix = pattern.partition("**")
    prefix = prefix.rstrip("/")
    suffix = suffix.lstrip("/")
    if prefix and not path.startswith(prefix):
        return False
    return fnmatch.fnmatch(path, f"*{suffix}") if suffix else True


def _apply_edit_unique(
    files: dict[str, str],
    path: str,
    old_text: str,
    new_text: str,
) -> tuple[dict[str, str], str | None]:
    key = _norm(path)
    content = files.get(key)
    if content is None:
        return files, f"ficheiro não encontrado: {key}"
    count = content.count(old_text)
    if count == 0:
        return files, f"old_text não encontrado em {key}"
    if count > 1:
        return files, (
            f"old_text ambíguo em {key} ({count} ocorrências) — inclui mais contexto "
            "para tornar único"
        )
    updated = dict(files)
    updated[key] = content.replace(old_text, new_text, 1)
    return updated, None


async def execute_agent_tool(
    settings: Settings,
    state: dict[str, Any],
    tool: str,
    args: dict[str, Any],
    *,
    project_files: dict[str, str],
    port: DevTerminalPort | None,
    depth: int = 0,
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

    if name == "glob":
        pattern = str(a.get("pattern") or a.get("glob") or "")
        matches = _glob_in_memory(files, pattern)
        return ("\n".join(matches) or "(sem correspondências)")[:MAX_TOOL_OUTPUT], files, ops

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

    if name in ("edit", "search_replace"):
        path = str(a.get("path") or "")
        old_text = str(a.get("old_text") or "")
        new_text = str(a.get("new_text") or "")
        key = _norm(path)
        if name == "edit":
            updated, err = _apply_edit_unique(files, path, old_text, new_text)
        else:  # search_replace legado — primeira ocorrência
            updated, err = apply_search_replace(files, path, old_text, new_text)
        if err:
            return f"Erro {name}: {err}", files, ops
        files = updated
        ops.append({"op": "write", "path": key, "content": files[key]})
        return f"OK: {name} aplicado em {key}", files, ops

    if name == "multi_edit":
        path = str(a.get("path") or "")
        key = _norm(path)
        edits = a.get("edits")
        if not isinstance(edits, list) or not edits:
            return "Erro multi_edit: 'edits' vazio", files, ops
        working = dict(files)
        for idx, e in enumerate(edits):
            if not isinstance(e, dict):
                return f"Erro multi_edit: edição {idx} inválida", files, ops
            working, err = _apply_edit_unique(
                working,
                path,
                str(e.get("old_text") or ""),
                str(e.get("new_text") or ""),
            )
            if err:
                return f"Erro multi_edit (edição {idx}): {err} — nenhuma aplicada", files, ops
        files = working
        ops.append({"op": "write", "path": key, "content": files[key]})
        return f"OK: multi_edit ({len(edits)} edições) em {key}", files, ops

    if name == "write_file":
        path = str(a.get("path") or "")
        content = str(a.get("content") or "")
        key = _norm(path)
        files = write_file(files, key, content)
        ops.append({"op": "write", "path": key, "content": content})
        return f"OK: escrito {key} ({len(content)} chars)", files, ops

    if name == "todo_write":
        todos = a.get("todos")
        if not isinstance(todos, list):
            return "Erro todo_write: 'todos' deve ser lista", files, ops
        return _render_todos(todos), files, ops

    if name in ("run_terminal", "apply_and_verify"):
        if name == "apply_and_verify":
            cmd = str(a.get("command") or "").strip() or _default_verify_command(files)
        else:
            cmd = str(a.get("command") or a.get("cmd") or "")
        if not cmd:
            return "Erro: command vazio", files, ops
        if not port:
            return "Erro: terminal não disponível neste ambiente", files, ops
        result = await port.run(cmd)
        out = result.output()[:MAX_TOOL_OUTPUT]
        status = "OK" if result.ok else "FAIL"
        return f"[{status}] $ {cmd}\n{out}", files, ops

    if name == "task":
        return await _run_subagent(settings, state, a, files, port, depth)

    return f"Ferramenta desconhecida: {tool}", files, ops


def _render_todos(todos: list[Any]) -> str:
    marks = {"completed": "[x]", "in_progress": "[~]", "pending": "[ ]"}
    lines = []
    for t in todos:
        if not isinstance(t, dict):
            continue
        mark = marks.get(str(t.get("status") or "pending"), "[ ]")
        lines.append(f"{mark} {t.get('content') or ''}")
    return "Checklist actualizada:\n" + ("\n".join(lines) or "(vazia)")


def _default_verify_command(files: dict[str, str]) -> str:
    if "package.json" in files:
        pkg = files.get("package.json") or ""
        try:
            data = json.loads(pkg)
            scripts = data.get("scripts") or {}
        except (json.JSONDecodeError, AttributeError):
            scripts = {}
        if "build" in scripts:
            return "npm run build"
        if "typecheck" in scripts:
            return "npm run typecheck"
        return "npx tsc --noEmit"
    if any(p.endswith(".py") for p in files):
        return "python -m pytest -q"
    return "echo 'sem verificação padrão'"


async def _run_subagent(
    settings: Settings,
    state: dict[str, Any],
    a: dict[str, Any],
    files: dict[str, str],
    port: DevTerminalPort | None,
    depth: int,
) -> tuple[str, dict[str, str], list[dict[str, Any]]]:
    """Delega a um subagente especializado via loop aninhado."""
    ops: list[dict[str, Any]] = []
    if not bool(getattr(settings, "dev_workflow_subagents_enabled", True)):
        return "Subagentes desactivados (dev_workflow_subagents_enabled=false)", files, ops
    if depth >= 1:
        return "Erro: subagentes não podem invocar subagentes (profundidade máx.)", files, ops

    subtype = str(a.get("subagent_type") or "implementer").strip().lower()
    sub_prompt = str(a.get("prompt") or "").strip()
    if not sub_prompt:
        return "Erro task: 'prompt' vazio", files, ops

    # Import tardio evita ciclo loop.py ↔ tools.py.
    from openpolvointeligence.graphs.dev_workflow.engines.agent_loop.loop import (
        run_agent_loop,
    )

    sub_state = dict(state)
    sub_state["project_files"] = files
    sub_state["user_prompt"] = sub_prompt
    sub_state["enriched_prompt"] = sub_prompt
    sub_state["_subagent_type"] = subtype
    sub_state["pending_writes"] = []

    max_iter = int(getattr(settings, "dev_workflow_subagent_max_iterations", 12) or 12)
    result = await run_agent_loop(settings, sub_state, max_iterations=max_iter, depth=depth + 1)

    sub_files = result.get("project_files")
    if isinstance(sub_files, dict):
        files = sub_files
    sub_ops = result.get("polvo_code_ops")
    if isinstance(sub_ops, list):
        ops = [o for o in sub_ops if isinstance(o, dict)]
    summary = str(result.get("assistant_text") or "").strip() or "(subagente sem resumo)"
    return f"[subagente:{subtype}] {summary[:2000]}", files, ops
