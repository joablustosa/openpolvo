"""Execução das VCS tools (git + gh) via subprocess local, com timeout.

App desktop local: o Intelligence corre na máquina do utilizador, logo `git`/`gh`
usam a auth e o workspace reais. A política/gate vive em ``policy.py``; aqui só
executamos o que já foi autorizado.

``_run_command`` é o único ponto de I/O — os testes fazem monkeypatch dele para não
tocar em git/gh reais.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.vcs import policy

_TIMEOUT_S = 120.0
_MAX_OUTPUT = 48_000


def _run_command(argv: list[str], *, cwd: str, timeout_s: float = _TIMEOUT_S) -> dict[str, Any]:
    """Corre um comando (sem shell) e devolve {ok, exit_code, output}."""
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "command_not_found",
            "hint": f"{argv[0]} não está instalado/no PATH",
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if len(out) > _MAX_OUTPUT:
        out = out[:_MAX_OUTPUT] + "\n… (truncado)"
    return {"ok": proc.returncode == 0, "exit_code": proc.returncode, "output": out}


def _git_argv(name: str, args: dict[str, Any]) -> tuple[list[str] | None, str | None]:
    """Constrói o argv git para a tool. Devolve (argv, erro)."""
    a = args
    if name == "git_status":
        return ["git", "status", "--short", "--branch"], None
    if name == "git_diff":
        rel = str(a.get("rel_path") or a.get("path") or "").strip()
        return ["git", "diff", "--stat", *([rel] if rel else [])], None
    if name == "git_log":
        try:
            n = int(a.get("max") or 20)
        except (TypeError, ValueError):
            n = 20
        n = max(1, min(n, 100))
        return ["git", "log", "--oneline", "-n", str(n)], None
    if name == "git_branch":
        branch = str(a.get("name") or "").strip()
        if branch:
            return ["git", "checkout", "-b", branch], None
        return ["git", "branch", "--all"], None
    if name == "git_checkout":
        ref = str(a.get("ref") or a.get("branch") or "").strip()
        if not ref:
            return None, "git_checkout: 'ref' obrigatório"
        return ["git", "checkout", ref], None
    if name == "git_pull":
        return ["git", "pull", "--ff-only"], None
    if name == "git_push":
        argv = ["git", "push"]
        if a.get("set_upstream"):
            branch = str(a.get("branch") or "").strip()
            argv += ["-u", "origin", *([branch] if branch else ["HEAD"])]
        return argv, None
    if name == "git_add":
        paths = str(a.get("paths") or "").strip()
        return ["git", "add", *(paths.split() if paths else ["-A"])], None
    if name == "git_commit":
        msg = str(a.get("message") or "").strip()
        if not msg:
            return None, "git_commit: 'message' obrigatório"
        return ["git", "commit", "-m", msg], None
    if name == "git_clone":
        repo = str(a.get("repo") or a.get("url") or "").strip()
        if not repo:
            return None, "git_clone: 'repo' obrigatório"
        target = str(a.get("dir") or "").strip()
        return ["git", "clone", repo, *([target] if target else [])], None
    return None, f"tool git desconhecida: {name}"


def write_allowed(settings: Settings, tool: str) -> bool:
    """Se ações de escrita podem correr no caminho local/headless (sem UI de aprovação)."""
    if bool(getattr(settings, "vcs_allow_write", False)):
        return True
    # Retrocompat: flag específica de commit já existente.
    if tool == "git_commit" and bool(getattr(settings, "desk_git_allow_commit", False)):
        return True
    return False


async def run_vcs_local(
    settings: Settings,
    *,
    name: str,
    args: dict[str, Any],
    workspace_path: str,
) -> dict[str, Any]:
    """Classifica, aplica o gate e executa uma VCS tool localmente."""
    a = args if isinstance(args, dict) else {}
    cwd = str(workspace_path or ".").strip() or "."

    if name in policy.GIT_TOOL_NAMES:
        access = policy.classify_git(name, a)
        gate = policy.enforce(access, write_allowed=write_allowed(settings, name))
        if gate is not None:
            return gate
        argv, err = _git_argv(name, a)
        if err:
            return {"ok": False, "error": "bad_args", "hint": err}
        # clone corre no diretório-pai para não exigir workspace existente.
        clone_cwd = str(Path(cwd).parent) if name == "git_clone" and Path(cwd).name else cwd
        return _run_command(argv, cwd=clone_cwd if name == "git_clone" else cwd)

    if name == "github":
        if not bool(getattr(settings, "github_tools_enabled", True)):
            return {"ok": False, "error": "github_tools_disabled"}
        access = policy.classify_gh(str(a.get("command") or ""))
        gate = policy.enforce(
            access, write_allowed=bool(getattr(settings, "vcs_allow_write", False))
        )
        if gate is not None:
            return gate
        return _run_command(["gh", *access.argv], cwd=cwd)

    return {"ok": False, "error": f"unknown_vcs_tool:{name}"}
