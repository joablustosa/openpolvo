"""Lógica pura das tools Desk — schemas, sandbox de paths e execução local (M2)."""

from __future__ import annotations

import asyncio
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
from openpolvointeligence.graphs.vcs import policy as vcs_policy
from openpolvointeligence.graphs.vcs.runner import run_vcs_local
from openpolvointeligence.graphs.web_research.web_tools import WEB_TOOL_NAMES, run_web_tool

# Tools VCS novas roteadas pelo dispatcher dedicado (git_status/diff/commit legados
# mantêm o fluxo antigo em execute_tool_local, para não alterar comportamento).
VCS_DISPATCH_TOOLS = frozenset(
    {
        "git_log",
        "git_branch",
        "git_checkout",
        "git_pull",
        "git_push",
        "git_add",
        "git_clone",
        "github",
    }
)

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


def apply_unique_edits(
    content: str,
    edits: list[dict[str, Any]],
) -> tuple[str | None, dict[str, Any] | None]:
    """Aplica edições old_text→new_text em sequência, todas-ou-nenhuma.

    Cada old_text tem de ser único no conteúdo corrente (mesma semântica do Edit
    do Claude Code). Devolve (novo_conteudo, None) ou (None, erro).
    """
    if not edits:
        return None, {"ok": False, "error": "empty_edits", "hint": "fornece pelo menos uma edição"}
    working = content
    for i, e in enumerate(edits):
        old = str(e.get("old_text") or "")
        new = str(e.get("new_text") or "")
        if not old:
            return None, {
                "ok": False,
                "error": "empty_old_text",
                "hint": f"edição {i}: old_text vazio",
            }
        count = working.count(old)
        if count == 0:
            return None, {
                "ok": False,
                "error": "old_text_not_found",
                "hint": f"edição {i}: o trecho não existe no ficheiro — relê o ficheiro primeiro",
            }
        if count > 1:
            return None, {
                "ok": False,
                "error": "old_text_ambiguous",
                "hint": (
                    f"edição {i}: {count} ocorrências — inclui mais linhas de contexto "
                    "no old_text para o tornar único"
                ),
            }
        working = working.replace(old, new, 1)
    return working, None


def _edit_file_local(
    workspace_path: str,
    rel_path: str,
    edits: list[dict[str, Any]],
) -> dict[str, Any]:
    """Edição cirúrgica em disco: lê, aplica edições únicas (atómico) e grava."""
    try:
        target = resolve_under_workspace(workspace_path, rel_path)
    except (PathTraversalError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}
    if not target.is_file():
        return {"ok": False, "error": "not_a_file", "hint": "usa filesystem_write para criar"}
    try:
        if target.stat().st_size > MAX_READ_BYTES:
            return {"ok": False, "error": "file_too_large"}
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    updated, err = apply_unique_edits(content, edits)
    if err is not None:
        return err
    assert updated is not None
    if len(updated.encode("utf-8")) > MAX_WRITE_BYTES:
        return {"ok": False, "error": "content_too_large"}
    try:
        target.write_text(updated, encoding="utf-8")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "output": f"{len(edits)} edição(ões) aplicada(s) em {rel_path}"}


def _terminal_denied(command: str) -> bool:
    return any(p.search(command) for p in TERMINAL_DENY_PATTERNS)


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """Mata o processo e todos os descendentes.

    `Popen.kill()` só mata a shell; no Windows os filhos (node/npm/npx) ficam
    vivos segurando os pipes e o `communicate()` bloqueia para sempre.
    """
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
                timeout=10,
                check=False,
            )
        else:
            import signal

            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:  # noqa: BLE001
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass


def _terminal_run_local(
    workspace_path: str,
    command: str,
    timeout_s: float = TERMINAL_TIMEOUT_S,
) -> dict[str, Any]:
    cmd = command.strip()
    if not cmd:
        return {"ok": False, "error": "empty_command"}
    if _terminal_denied(cmd):
        return {"ok": False, "error": "command_denied"}
    root = Path(workspace_path).resolve()
    if not root.is_dir():
        return {"ok": False, "error": "workspace_not_found"}
    popen_kwargs: dict[str, Any] = {}
    if os.name != "nt":
        popen_kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(
            cmd,
            shell=True,
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            **popen_kwargs,
        )
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _kill_process_tree(proc)
        try:
            proc.communicate(timeout=5)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "error": "timeout"}
    except OSError as exc:
        _kill_process_tree(proc)
        return {"ok": False, "error": str(exc)}
    out = (stdout or "") + (stderr or "")
    if len(out) > 32_000:
        out = out[:32_000] + "\n… (truncado)"
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "output": out.strip(),
    }


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
    if name == "filesystem_edit":
        rel = str(args.get("rel_path") or args.get("path") or "")
        edit = {
            "old_text": str(args.get("old_text") or ""),
            "new_text": str(args.get("new_text") or ""),
        }
        return _edit_file_local(wp, rel, [edit])
    if name == "filesystem_multi_edit":
        rel = str(args.get("rel_path") or args.get("path") or "")
        raw_edits = args.get("edits")
        edits = [e for e in raw_edits if isinstance(e, dict)] if isinstance(raw_edits, list) else []
        return _edit_file_local(wp, rel, edits)
    if name == "terminal_run":
        timeout_s = float(
            getattr(settings, "dev_workflow_terminal_timeout_s", 0) or TERMINAL_TIMEOUT_S,
        )
        return _terminal_run_local(wp, str(args.get("command") or ""), timeout_s=timeout_s)
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


class FsEditArgs(BaseModel):
    rel_path: str = Field(description="Caminho relativo do ficheiro existente")
    old_text: str = Field(description="Trecho exacto a substituir (tem de ser único no ficheiro)")
    new_text: str = Field(description="Novo trecho")


class FsEditOp(BaseModel):
    old_text: str = Field(description="Trecho exacto a substituir (único no ficheiro)")
    new_text: str = Field(description="Novo trecho")


class FsMultiEditArgs(BaseModel):
    rel_path: str = Field(description="Caminho relativo do ficheiro existente")
    edits: list[FsEditOp] = Field(
        description="Edições aplicadas em ordem; se alguma falhar, nenhuma é aplicada"
    )


class TerminalRunArgs(BaseModel):
    command: str = Field(description="Comando shell a executar no workspace")


class GitDiffArgs(BaseModel):
    rel_path: str = Field(default="", description="Ficheiro opcional para diff")


class GitCommitArgs(BaseModel):
    message: str = Field(description="Mensagem de commit")


class WebSearchArgs(BaseModel):
    query: str = Field(description="Termos de pesquisa (linguagem natural)")
    max_results: int = Field(default=5, description="Nº de resultados (1-10)")


class WebFetchArgs(BaseModel):
    url: str = Field(description="URL http(s) pública a ler")


class GitLogArgs(BaseModel):
    max: int = Field(default=20, description="Nº de commits a mostrar (1-100)")


class GitBranchArgs(BaseModel):
    name: str = Field(default="", description="Sem nome: lista branches. Com nome: cria a branch")


class GitCheckoutArgs(BaseModel):
    ref: str = Field(description="Branch/commit para mudar (git checkout)")


class GitPushArgs(BaseModel):
    set_upstream: bool = Field(
        default=False, description="Definir upstream (-u origin) no primeiro push"
    )
    branch: str = Field(default="", description="Branch a publicar (default: HEAD)")


class GitAddArgs(BaseModel):
    paths: str = Field(
        default="", description="Ficheiros a stage separados por espaço (vazio = tudo)"
    )


class GitCloneArgs(BaseModel):
    repo: str = Field(description="URL ou owner/repo a clonar")
    dir: str = Field(default="", description="Diretório de destino (opcional)")


class GithubArgs(BaseModel):
    command: str = Field(
        description=(
            "Comando gh sem o 'gh' inicial, ex.: \"pr create --title 'x' --body 'y'\", "
            '"pr list", "issue view 12", "pr checks". Ações de escrita requerem aprovação.'
        )
    )


def classify_vcs(name: str, args: dict[str, Any]) -> vcs_policy.Access:
    """Classifica uma VCS tool (git por nome, github por comando)."""
    if name == "github":
        return vcs_policy.classify_gh(str((args or {}).get("command") or ""))
    return vcs_policy.classify_git(name, args or {})


def _stub_tool(name: str, **_kwargs: Any) -> str:
    return f"[{name}] delegado ao cliente"


def _web_stub(name: str, **_kwargs: Any) -> str:
    return f"[{name}] executado no servidor"


def desk_langchain_tools(settings: Settings | None = None) -> list[StructuredTool]:
    """Tools expostas ao LLM — execução real no nó `tools`.

    As tools de web (`web_search`/`web_fetch`) executam server-side em
    ``dispatch_tool_calls`` (não passam pelo bridge do cliente).
    """
    tools: list[StructuredTool] = [
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
            description=(
                "Cria um ficheiro novo ou reescreve-o por completo. Para alterar um "
                "ficheiro existente prefere filesystem_edit (edição cirúrgica)."
            ),
            args_schema=FsWriteArgs,
        ),
        StructuredTool.from_function(
            func=lambda rel_path, old_text, new_text: _stub_tool(
                "filesystem_edit", rel_path=rel_path, old_text=old_text, new_text=new_text
            ),
            name="filesystem_edit",
            description=(
                "Edição cirúrgica: substitui old_text por new_text num ficheiro existente. "
                "old_text tem de ser único no ficheiro (erro se ambíguo — inclui mais contexto). "
                "Preferido a filesystem_write para alterar ficheiros. Lê o ficheiro antes de editar."
            ),
            args_schema=FsEditArgs,
        ),
        StructuredTool.from_function(
            func=lambda rel_path, edits: _stub_tool(
                "filesystem_multi_edit", rel_path=rel_path, edits=edits
            ),
            name="filesystem_multi_edit",
            description=(
                "Aplica várias edições cirúrgicas ao mesmo ficheiro, em ordem e de forma "
                "atómica: se alguma falhar, nenhuma é aplicada. Usa para mudanças em vários "
                "pontos do mesmo ficheiro."
            ),
            args_schema=FsMultiEditArgs,
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

    if settings is None or bool(getattr(settings, "web_tools_enabled", True)):
        tools.extend(
            [
                StructuredTool.from_function(
                    func=lambda query, max_results=5: _web_stub(
                        "web_search", query=query, max_results=max_results
                    ),
                    name="web_search",
                    description=(
                        "Pesquisa na web (motor de busca) e devolve títulos, URLs e resumos. "
                        "Usa quando precisas de documentação, versões de libs, mensagens de erro "
                        "ou factos que não estão no workspace. Precisa de SERPAPI_API_KEY."
                    ),
                    args_schema=WebSearchArgs,
                ),
                StructuredTool.from_function(
                    func=lambda url: _web_stub("web_fetch", url=url),
                    name="web_fetch",
                    description=(
                        "Lê o conteúdo textual de uma página web pública (http/https). "
                        "Usa depois de web_search para abrir uma URL específica, ou quando o "
                        "utilizador indica um link."
                    ),
                    args_schema=WebFetchArgs,
                ),
            ]
        )

    tools.extend(
        [
            StructuredTool.from_function(
                func=lambda max=20: _stub_tool("git_log", max=max),
                name="git_log",
                description="Mostra os últimos commits (git log --oneline).",
                args_schema=GitLogArgs,
            ),
            StructuredTool.from_function(
                func=lambda name="": _stub_tool("git_branch", name=name),
                name="git_branch",
                description="Lista branches (sem nome) ou cria uma nova branch (com nome, requer aprovação).",
                args_schema=GitBranchArgs,
            ),
            StructuredTool.from_function(
                func=lambda ref: _stub_tool("git_checkout", ref=ref),
                name="git_checkout",
                description="Muda para outra branch/commit (git checkout). Requer aprovação.",
                args_schema=GitCheckoutArgs,
            ),
            StructuredTool.from_function(
                func=lambda: _stub_tool("git_pull"),
                name="git_pull",
                description="Actualiza a branch a partir do remoto (git pull --ff-only). Requer aprovação.",
            ),
            StructuredTool.from_function(
                func=lambda set_upstream=False, branch="": _stub_tool(
                    "git_push", set_upstream=set_upstream, branch=branch
                ),
                name="git_push",
                description="Publica commits no remoto (git push). Requer aprovação. --force é bloqueado.",
                args_schema=GitPushArgs,
            ),
            StructuredTool.from_function(
                func=lambda paths="": _stub_tool("git_add", paths=paths),
                name="git_add",
                description="Faz stage de ficheiros (git add). Requer aprovação.",
                args_schema=GitAddArgs,
            ),
            StructuredTool.from_function(
                func=lambda repo, dir="": _stub_tool("git_clone", repo=repo, dir=dir),
                name="git_clone",
                description="Clona um repositório (git clone). Requer aprovação.",
                args_schema=GitCloneArgs,
            ),
        ]
    )

    if settings is None or bool(getattr(settings, "github_tools_enabled", True)):
        tools.append(
            StructuredTool.from_function(
                func=lambda command: _stub_tool("github", command=command),
                name="github",
                description=(
                    "GitHub CLI (gh): PRs, issues, checks e repositórios. Passa o comando sem "
                    "o 'gh', ex.: \"pr create --title 'x' --body 'y'\", \"pr list\", "
                    '"pr checks", "issue view 12". Leituras são automáticas; ações de '
                    "escrita (create/merge/close/comment…) requerem aprovação."
                ),
                args_schema=GithubArgs,
            )
        )
    return tools


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

        vcs_access = classify_vcs(name, args) if name in VCS_DISPATCH_TOOLS else None

        payload = {"id": call_id, "tool": name, "name": name, "args": args}
        if vcs_access is not None and vcs_access.allowed and vcs_access.is_write:
            payload["requires_approval"] = True
        if emit:
            await emit("tool_call", payload)

        if name in WEB_TOOL_NAMES:
            # Tools de web executam server-side (têm a key/httpx no Intelligence);
            # não passam pelo bridge do cliente.
            result = await run_web_tool(settings, name=name, args=args)
        elif vcs_access is not None:
            if vcs_access.blocked:
                # Bloqueio server-side — nunca chega ao cliente nem executa.
                result = {
                    "ok": False,
                    "error": "vcs_blocked",
                    "hint": vcs_access.reason,
                    "blocked": True,
                }
            elif use_local or settings.desk_tools_local:
                result = await run_vcs_local(
                    settings, name=name, args=args, workspace_path=workspace_path
                )
            else:
                # Cliente executa (git/gh reais + UI de aprovação); sinalizamos requires_approval.
                result = await bridge_wait(
                    conversation_id,
                    call_id,
                    {"tool": name, "args": args, "requires_approval": bool(vcs_access.is_write)},
                    TERMINAL_TIMEOUT_S,
                )
        elif use_local or settings.desk_tools_local:
            # subprocess síncrono num thread — não bloquear o event loop (SSE).
            result = await asyncio.to_thread(
                execute_tool_local,
                settings,
                tool_name=name,
                args=args,
                workspace_path=workspace_path,
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
