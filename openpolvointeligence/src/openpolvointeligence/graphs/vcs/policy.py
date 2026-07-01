"""Política pura (sem I/O) de classificação e gate para as VCS tools (git + gh).

Regras:
- **Default-deny** no `gh`: só resource+action na allowlist são aceites.
- Classificação **read** (auto) vs **write** (requer aprovação) vs **blocked** (nunca corre).
- O gate é aplicado por :func:`enforce`, que decide se uma ação write pode correr no
  caminho local/headless (só quando o utilizador permitiu explicitamente).

Tudo aqui é função pura e testável — a execução real vive em ``runner.py``.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass

# Nomes das tools git expostas ao agente (a classificação read/write depende dos args).
GIT_TOOL_NAMES = frozenset(
    {
        "git_status",
        "git_diff",
        "git_log",
        "git_branch",
        "git_checkout",
        "git_pull",
        "git_push",
        "git_add",
        "git_commit",
        "git_clone",
    }
)

# Ações git só de leitura (não alteram working tree nem remoto).
_GIT_READ = frozenset({"git_status", "git_diff", "git_log"})

# gh: allowlist por "resource action". Default-deny para tudo o resto.
_GH_READ: dict[str, frozenset[str]] = {
    "pr": frozenset({"list", "view", "checks", "diff", "status"}),
    "issue": frozenset({"list", "view", "status"}),
    "repo": frozenset({"view", "list", "clone"}),
    "run": frozenset({"list", "view", "watch"}),
    "release": frozenset({"list", "view"}),
    "label": frozenset({"list"}),
    "auth": frozenset({"status"}),
}
_GH_WRITE: dict[str, frozenset[str]] = {
    "pr": frozenset({"create", "merge", "close", "edit", "comment", "review", "ready", "reopen"}),
    "issue": frozenset({"create", "close", "edit", "comment", "reopen"}),
    "repo": frozenset({"create", "fork"}),
    "release": frozenset({"create", "edit"}),
    "run": frozenset({"rerun", "cancel"}),
    "label": frozenset({"create", "edit"}),
}
# Combinações explicitamente perigosas — bloqueadas mesmo com aprovação.
_GH_BLOCKED: dict[str, frozenset[str]] = {
    "repo": frozenset({"delete", "archive"}),
    "release": frozenset({"delete"}),
    "label": frozenset({"delete"}),
    "secret": frozenset({"set", "delete", "remove"}),
    "auth": frozenset({"login", "logout", "refresh", "token"}),
}
# Resources totalmente bloqueados (poderosos/perigosos demais nesta iteração).
_GH_BLOCKED_RESOURCES = frozenset({"api", "secret", "ssh-key", "gpg-key", "codespace", "alias"})

# Metacaracteres de shell rejeitados em comandos gh (defesa em profundidade —
# a execução nunca usa shell=True, mas rejeitamos por precaução).
_SHELL_METACHARS = frozenset(";|&$`<>\n")


@dataclass(frozen=True)
class Access:
    allowed: bool
    is_write: bool
    reason: str = ""
    # Comando normalizado (tokens sem o "gh" inicial), quando aplicável.
    argv: tuple[str, ...] = ()

    @property
    def blocked(self) -> bool:
        return not self.allowed


def _has_force_flag(args: dict) -> bool:
    force = args.get("force")
    if isinstance(force, bool):
        return force
    return str(force or "").strip().lower() in ("1", "true", "yes")


def classify_git(tool: str, args: dict) -> Access:
    """Classifica uma tool git pelo nome + args."""
    name = (tool or "").strip().lower()
    a = args if isinstance(args, dict) else {}
    if name in _GIT_READ:
        return Access(True, False)
    if name == "git_branch":
        # Sem 'name' → listar (read); com 'name' → criar (write).
        return Access(True, bool(str(a.get("name") or "").strip()))
    if name == "git_push":
        if _has_force_flag(a):
            return Access(False, False, "git_push --force bloqueado (destrutivo)")
        return Access(True, True)
    if name in ("git_checkout", "git_pull", "git_add", "git_commit", "git_clone"):
        return Access(True, True)
    return Access(False, False, f"tool git desconhecida: {name}")


def parse_gh(command: str) -> tuple[list[str], str | None]:
    """Faz shlex do comando gh (sem o 'gh' inicial). Devolve (tokens, erro)."""
    raw = str(command or "").strip()
    if not raw:
        return [], "comando gh vazio"
    if any(ch in raw for ch in _SHELL_METACHARS):
        return [], "comando gh contém metacaracteres de shell não permitidos"
    try:
        tokens = shlex.split(raw)
    except ValueError as exc:
        return [], f"comando gh inválido: {exc}"
    if tokens and tokens[0].lower() == "gh":
        tokens = tokens[1:]
    if not tokens:
        return [], "comando gh vazio"
    return tokens, None


def classify_gh(command: str) -> Access:
    """Classifica um comando gh por resource+action (default-deny)."""
    tokens, err = parse_gh(command)
    if err:
        return Access(False, False, err)
    resource = tokens[0].lower()
    action = tokens[1].lower() if len(tokens) > 1 else ""
    argv = tuple(tokens)
    if resource in _GH_BLOCKED_RESOURCES:
        return Access(False, False, f"gh {resource} bloqueado", argv)
    if action and action in _GH_BLOCKED.get(resource, frozenset()):
        return Access(False, False, f"gh {resource} {action} bloqueado (perigoso)", argv)
    if action and action in _GH_READ.get(resource, frozenset()):
        return Access(True, False, "", argv)
    if action and action in _GH_WRITE.get(resource, frozenset()):
        return Access(True, True, "", argv)
    return Access(
        False,
        False,
        f"gh '{resource} {action}'".strip() + " não está na allowlist",
        argv,
    )


def enforce(access: Access, *, write_allowed: bool) -> dict | None:
    """Aplica o gate. Devolve dict de erro se não puder correr; None se ok.

    - blocked → erro (nunca corre).
    - write sem permissão → ``approval_required`` com ``requires_approval=True``.
    - read ou write permitido → None (segue para execução).
    """
    if access.blocked:
        return {"ok": False, "error": "vcs_blocked", "hint": access.reason, "blocked": True}
    if access.is_write and not write_allowed:
        return {
            "ok": False,
            "error": "approval_required",
            "requires_approval": True,
            "hint": "ação de escrita — precisa de aprovação (ou VCS_ALLOW_WRITE no modo local)",
        }
    return None
