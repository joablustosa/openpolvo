"""Prompts partilhados DevAgent — system mestre injectado em todos os nós LLM."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

_logger = logging.getLogger(__name__)
_PROMPTS_ROOT = Path(__file__).resolve().parent.parent / "prompts"
_LEGACY_PROMPTS = Path(__file__).resolve().parent.parent.parent.parent / "prompts" / "dev_agent"


def _resolve_prompt_path(name: str) -> Path:
    """Resolve prompt em dev_workflow/prompts/ com fallback legacy."""
    base_name = name if name.endswith(".md") else f"{name}.md"
    candidates = [
        _PROMPTS_ROOT / base_name,
        _PROMPTS_ROOT / "agents" / base_name,
        _PROMPTS_ROOT / "protocols" / base_name,
        _LEGACY_PROMPTS / base_name,
    ]
    aliases = {
        "dev_agent_system.md": _PROMPTS_ROOT / "base.md",
        "base_system.md": _PROMPTS_ROOT / "security.md",
        "terminal_system.md": _PROMPTS_ROOT / "protocols" / "terminal_system.md",
        "workflow_protocols.md": _PROMPTS_ROOT / "protocols" / "workflow_protocols.md",
    }
    if base_name in aliases:
        candidates.insert(0, aliases[base_name])
    for path in candidates:
        if path.is_file():
            return path
    return _LEGACY_PROMPTS / base_name


@lru_cache(maxsize=64)
def load_dev_agent_prompt(name: str) -> str:
    path = _resolve_prompt_path(name)
    if not path.is_file():
        _logger.warning("Prompt dev_agent em falta: %s", path)
        return ""
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def dev_agent_system_prompt() -> str:
    return load_dev_agent_prompt("dev_agent_system")


def load_agent_prompt(name: str) -> str:
    """Carrega prompt de agente (ex.: requirements_agent)."""
    return load_dev_agent_prompt(name)


def inject_dev_agent_system(node_prompt: str) -> str:
    """Prefixa o system DevAgent ao prompt específico do nó."""
    master = dev_agent_system_prompt().strip()
    node = (node_prompt or "").strip()
    if not master:
        return node
    if not node:
        return master
    return f"{master}\n\n---\n\n{node}"


def inject_agent_prompt(agent_name: str, node_prompt: str = "", workflow_id: str = "") -> str:
    """Prefixa base_system + dev_agent_system + prompt do agente + contexto terminal."""
    from openpolvointeligence.graphs.dev_workflow.integrations.plugins.skills_loader import (
        load_skills_snippet,
    )

    skills = load_skills_snippet(max_chars=2000)
    parts = [
        load_dev_agent_prompt("base_system"),
        load_terminal_context(workflow_id)
        if workflow_id
        else load_dev_agent_prompt("terminal_system"),
        load_agent_prompt(f"{agent_name}_agent"),
        node_prompt,
    ]
    if skills:
        parts.append(f"## Skills disponíveis\n{skills}")
    combined = "\n\n".join(p.strip() for p in parts if p.strip())
    return inject_dev_agent_system(combined)


def load_terminal_context(workflow_id: str) -> str:
    """Concatena terminal_system + protocolo do workflow."""
    terminal = load_dev_agent_prompt("terminal_system")
    protocols_path = _PROMPTS_ROOT / "protocols" / "workflow_protocols.md"
    protocols = (
        protocols_path.read_text(encoding="utf-8")
        if protocols_path.is_file()
        else load_dev_agent_prompt("workflow_protocols")
    )
    if not workflow_id or not protocols:
        return terminal
    marker = f"### QUANDO ATIVADO NO `{workflow_id}_workflow`"
    if marker in protocols:
        start = protocols.index(marker)
        rest = protocols[start:]
        end = rest.find("\n### QUANDO ATIVADO NO `", 1)
        section = rest[:end] if end > 0 else rest
        return f"{terminal}\n\n---\n\n{section}".strip()
    return terminal
