"""Sanitiza TSX de projectos preview — evita imports de pacotes ausentes no scaffold."""

from __future__ import annotations

import re

_FORBIDDEN = (
    "react-router-dom",
    "react-router",
    "@tanstack/react-query",
    "next/link",
    "next/navigation",
)

_IMPORT_RE = re.compile(
    r"^\s*import\s+[^;]*from\s+['\"](?:" + "|".join(re.escape(p) for p in _FORBIDDEN) + r")['\"]",
    re.MULTILINE,
)


def preview_source_has_forbidden_imports(content: str) -> bool:
    if not content:
        return False
    return any(p in content for p in _FORBIDDEN) and "import" in content


def sanitize_preview_tsx(content: str, path: str = "") -> str:
    if not (content or "").strip():
        return content
    if path and not path.endswith((".tsx", ".jsx")):
        return content

    lines: list[str] = []
    for line in content.splitlines():
        if _IMPORT_RE.match(line):
            continue
        if "react-router" in line and "import" in line:
            continue
        lines.append(line)

    out = "\n".join(lines)
    out = out.replace("<Link", "<a")
    out = out.replace("</Link>", "</a>")
    out = re.sub(r"\s+to=\{", " href={", out)
    out = re.sub(r'\s+to="', ' href="', out)
    out = re.sub(r"\s+to='", " href='", out)
    out = re.sub(r"\s+component=\{[^}]+\}", "", out)
    return out


def sanitize_write_op(path: str, content: str) -> str:
    p = str(path).replace("\\", "/")
    if p.endswith((".tsx", ".jsx")):
        return sanitize_preview_tsx(content, p)
    return content
