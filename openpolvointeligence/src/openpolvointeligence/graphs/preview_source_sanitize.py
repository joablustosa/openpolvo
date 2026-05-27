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

_ROUTER_JSX_RE = re.compile(r"</?(?:Router|Routes|Route|BrowserRouter|Navigate)\b", re.I)

_REFERENCE_ROUTER_RE = re.compile(r"ReferenceError:\s*Router\s+is not defined", re.I)


def preview_source_has_forbidden_imports(content: str) -> bool:
    if not content:
        return False
    return any(p in content for p in _FORBIDDEN) and "import" in content


def uses_router_jsx(content: str) -> bool:
    return bool(_ROUTER_JSX_RE.search(content or ""))


def strip_react_router_jsx(content: str) -> str:
    """Remove wrappers react-router; mantém o `element` das rotas quando possível."""
    if not uses_router_jsx(content):
        return content

    out = content
    out = re.sub(
        r"<Route\b[^>]*\belement=\{([^}]+)\}[^>]*/>",
        r"\1",
        out,
        flags=re.I | re.DOTALL,
    )
    out = re.sub(r"<Route\b[^>]*>([^<]*)</Route>", r"\1", out, flags=re.I)
    for tag in ("BrowserRouter", "Router", "Routes"):
        out = re.sub(rf"<{tag}\b[^>]*>\s*", "", out, flags=re.I)
        out = re.sub(rf"\s*</{tag}>", "", out, flags=re.I)
    out = re.sub(r"<Navigate\b[^>]*/>\s*", "", out, flags=re.I)
    return out


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def _infer_main_page(
    app_content: str, project_files: dict[str, str],
) -> tuple[str, str, bool]:
    """Devolve (linha import, nome componente, showSidebar)."""
    show_sidebar = "showSidebar" in app_content

    page_imp = re.search(
        r'import\s+(\w+)\s+from\s+["\']@/pages/(\w+)["\']',
        app_content,
    )
    if page_imp:
        name = page_imp.group(1)
        return (
            f'import {name} from "@/pages/{page_imp.group(2)}"',
            name,
            show_sidebar,
        )

    m = re.search(r"element=\{\s*<(\w+)", app_content)
    if m:
        name = m.group(1)
        imp = re.search(
            rf'import\s+(?:\{{\s*)?{re.escape(name)}\s*(?:\}})?\s+from\s+["\']([^"\']+)["\']',
            app_content,
        )
        if imp:
            return f'import {name} from "{imp.group(1)}"', name, show_sidebar
        guess = f"src/pages/{name}.tsx"
        keys = {_norm_path(k) for k in project_files}
        if guess in keys:
            return f'import {name} from "@/pages/{name}"', name, show_sidebar

    pages = sorted(
        _norm_path(p)
        for p in project_files
        if _norm_path(p).startswith("src/pages/") and p.endswith((".tsx", ".jsx"))
    )
    for pref in ("LandingPage", "HomePage", "DashboardPage", "Index", "Page"):
        for p in pages:
            base = p.split("/")[-1]
            name = re.sub(r"\.(tsx|jsx)$", "", base, flags=re.I)
            if pref.lower() in name.lower():
                return f'import {name} from "@/pages/{name}"', name, show_sidebar

    if pages:
        base = pages[0].split("/")[-1]
        name = re.sub(r"\.(tsx|jsx)$", "", base, flags=re.I)
        return f'import {name} from "@/pages/{name}"', name, show_sidebar

    return "", "", show_sidebar


def rebuild_app_tsx_without_router(
    app_content: str, project_files: dict[str, str] | None = None,
) -> str:
    """Padrão AppShell + página — alinhado ao scaffold Vite do Dev Studio."""
    files = project_files or {}
    import_line, component, show_sidebar = _infer_main_page(app_content, files)
    sidebar_attr = " showSidebar" if show_sidebar else ""
    lines = ['import AppShell from "@/components/layout/AppShell"']
    if import_line:
        lines.append(import_line)
    lines.append("")
    lines.append("export default function App() {")
    lines.append("  return (")
    lines.append(f"    <AppShell{sidebar_attr}>")
    if component:
        lines.append(f"      <{component} />")
    else:
        lines.append(
            '      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24">',
        )
        lines.append('        <p className="text-muted-foreground">Preview</p>')
        lines.append("      </section>")
    lines.append("    </AppShell>")
    lines.append("  );")
    lines.append("}")
    return "\n".join(lines) + "\n"


def fix_app_tsx_if_router_broken(
    content: str, project_files: dict[str, str] | None = None,
) -> str:
    """Se ainda há JSX de router sem import válido, reconstrói App.tsx."""
    stripped = strip_react_router_jsx(content)
    if uses_router_jsx(stripped):
        return rebuild_app_tsx_without_router(content, project_files)
    if re.search(r"\bRouter\b", stripped) and "react-router" not in content:
        return rebuild_app_tsx_without_router(content, project_files)
    if "export default function App" in stripped and "AppShell" not in stripped:
        return rebuild_app_tsx_without_router(content, project_files)
    return stripped


def build_router_reference_heal_ops(
    compile_log: str, project_files: dict[str, str],
) -> list[dict[str, str]] | None:
    """Heal determinístico: ReferenceError Router is not defined."""
    if not _REFERENCE_ROUTER_RE.search(compile_log or ""):
        return None
    app = project_files.get("src/App.tsx") or project_files.get("src\\App.tsx")
    if not app:
        return None
    fixed = fix_app_tsx_if_router_broken(app, project_files)
    if fixed.strip() == app.strip():
        return None
    return [{"op": "write", "path": "src/App.tsx", "content": fixed}]


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

    out = strip_react_router_jsx(out)
    norm = _norm_path(path) if path else ""
    if norm == "src/App.tsx" or (not path and uses_router_jsx(out)):
        out = fix_app_tsx_if_router_broken(out, None)

    return out


def sanitize_write_op(path: str, content: str) -> str:
    p = str(path).replace("\\", "/")
    if p.endswith((".tsx", ".jsx")):
        return sanitize_preview_tsx(content, p)
    return content
