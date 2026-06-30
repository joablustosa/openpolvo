"""MCP tool registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class McpToolSpec:
    name: str
    description: str
    handler: Callable[..., Any] | None = None


@dataclass
class McpRegistry:
    tools: dict[str, McpToolSpec] = field(default_factory=dict)

    def register(self, spec: McpToolSpec) -> None:
        self.tools[spec.name] = spec

    def list_tools(self) -> list[dict[str, str]]:
        return [{"name": t.name, "description": t.description} for t in self.tools.values()]


_registry = McpRegistry()


def get_mcp_registry() -> McpRegistry:
    return _registry


def register_desk_bridge_tools() -> None:
    for name, desc in (
        ("filesystem_read", "Read file from workspace"),
        ("filesystem_write", "Write file to workspace"),
        ("terminal_run", "Run shell command"),
        ("git_status", "Git status"),
        ("git_commit", "Git commit"),
    ):
        _registry.register(McpToolSpec(name=name, description=desc))
