"""Mapa de exports dos componentes shadcn do scaffold Dev Studio (espelha openpolvo shadcnScaffold)."""

from __future__ import annotations

import re
from typing import Any

# stem do módulo `@/components/ui/{stem}` → símbolos exportados
SHADCN_UI_EXPORTS: dict[str, frozenset[str]] = {
    "badge": frozenset({"Badge", "badgeVariants"}),
    "button": frozenset({"Button", "buttonVariants"}),
    "card": frozenset(
        {
            "Card",
            "CardHeader",
            "CardFooter",
            "CardTitle",
            "CardAction",
            "CardDescription",
            "CardContent",
        },
    ),
    "dialog": frozenset(
        {
            "Dialog",
            "DialogPortal",
            "DialogOverlay",
            "DialogTrigger",
            "DialogClose",
            "DialogContent",
            "DialogHeader",
            "DialogFooter",
            "DialogTitle",
            "DialogDescription",
        },
    ),
    "input": frozenset({"Input"}),
    "label": frozenset({"Label"}),
    "select": frozenset(
        {
            "Select",
            "SelectContent",
            "SelectGroup",
            "SelectItem",
            "SelectLabel",
            "SelectScrollDownButton",
            "SelectScrollUpButton",
            "SelectSeparator",
            "SelectTrigger",
            "SelectValue",
        },
    ),
    "separator": frozenset({"Separator"}),
    "table": frozenset(
        {"Table", "TableHeader", "TableBody", "TableHead", "TableRow", "TableCell"},
    ),
}

_EXPORT_TO_MODULE: dict[str, str] = {
    symbol: stem for stem, symbols in SHADCN_UI_EXPORTS.items() for symbol in symbols
}

_NAMED_IMPORT_RE = re.compile(
    r"""import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](@/components/ui/[^'"]+)['"]""",
    re.MULTILINE,
)

_EXPORT_NAME_ERROR_RE = re.compile(
    r"""does not provide an export named ['"](?P<symbol>\w+)['"]""",
    re.I,
)


def shadcn_module_stem(spec: str) -> str | None:
    """Extrai o stem (ex.: `input`) de `@/components/ui/input`."""
    s = str(spec or "").strip()
    if not s.startswith("@/components/ui/"):
        return None
    tail = s[len("@/components/ui/") :].strip("/")
    if not tail or "/" in tail:
        return None
    return tail.removesuffix(".tsx").removesuffix(".ts")


def parse_import_symbols(raw: str) -> list[str]:
    """Lista símbolos de `import { A, B as C }`."""
    out: list[str] = []
    for part in str(raw or "").split(","):
        chunk = part.strip()
        if not chunk:
            continue
        name = chunk.split(" as ")[0].strip()
        if name:
            out.append(name)
    return out


def find_shadcn_module_for_symbol(symbol: str) -> str | None:
    return _EXPORT_TO_MODULE.get(symbol)


def validate_shadcn_named_imports(
    file_path: str,
    content: str,
) -> list[dict[str, Any]]:
    """Devolve digests de erro para imports shadcn inválidos."""
    errors: list[dict[str, Any]] = []
    body = str(content or "")

    for m in _NAMED_IMPORT_RE.finditer(body):
        spec = m.group(2)
        stem = shadcn_module_stem(spec)
        if not stem:
            continue
        allowed = SHADCN_UI_EXPORTS.get(stem, frozenset())
        for symbol in parse_import_symbols(m.group(1)):
            if symbol in allowed:
                continue
            correct = find_shadcn_module_for_symbol(symbol)
            if correct:
                msg = (
                    f"'{symbol}' não é exportado por '{spec}' — "
                    f"use `@/components/ui/{correct}`"
                )
            else:
                msg = f"'{symbol}' não é exportado por '{spec}' (componente shadcn desconhecido)"
            errors.append(
                {
                    "path": file_path,
                    "line": body[: m.start()].count("\n") + 1,
                    "column": None,
                    "code": "shadcn_import",
                    "message": msg,
                    "symbol": symbol,
                    "wrong_spec": spec,
                    "correct_spec": f"@/components/ui/{correct}" if correct else None,
                },
            )
    return errors


def rewrite_shadcn_imports(content: str) -> tuple[str, bool]:
    """
    Reagrupa imports shadcn inválidos em imports correctos por módulo.
    Devolve (conteúdo, alterou?).
    """
    body = str(content or "")
    if not body.strip():
        return body, False

    # Recolhe todos os imports shadcn nomeados
    imports_by_spec: dict[str, list[str]] = {}
    spans: list[tuple[int, int]] = []

    for m in _NAMED_IMPORT_RE.finditer(body):
        spec = m.group(2)
        spans.append((m.start(), m.end()))
        bucket = imports_by_spec.setdefault(spec, [])
        for sym in parse_import_symbols(m.group(1)):
            if sym not in bucket:
                bucket.append(sym)

    if not imports_by_spec:
        return body, False

    # Redistribui símbolos para o módulo correcto
    fixed_by_spec: dict[str, list[str]] = {}
    changed = False
    for spec, symbols in imports_by_spec.items():
        stem = shadcn_module_stem(spec)
        allowed = SHADCN_UI_EXPORTS.get(stem or "", frozenset())
        for sym in symbols:
            target_stem = stem if sym in allowed else find_shadcn_module_for_symbol(sym)
            if not target_stem:
                target_stem = stem or "button"
            target_spec = f"@/components/ui/{target_stem}"
            if target_spec != spec or sym not in allowed:
                changed = True
            bucket = fixed_by_spec.setdefault(target_spec, [])
            if sym not in bucket:
                bucket.append(sym)

    if not changed:
        return body, False

    # Remove imports shadcn antigos (de trás para a frente)
    new_body = body
    for start, end in reversed(spans):
        new_body = new_body[:start] + new_body[end:]

    # Insere imports corrigidos no topo (após outros imports existentes)
    import_lines = [
        f"import {{ {', '.join(sorted(syms))} }} from \"{spec}\""
        for spec, syms in sorted(fixed_by_spec.items())
        if syms
    ]
    insert_block = "\n".join(import_lines) + ("\n" if import_lines else "")

    # Posição: após bloco de imports existente ou início do ficheiro
    lines = new_body.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("import ") or stripped.startswith("export type"):
            insert_at = i + 1
        elif stripped and not stripped.startswith("//"):
            break
    lines.insert(insert_at, insert_block if insert_block.endswith("\n") else insert_block + "\n")
    return "".join(lines), True


def build_shadcn_import_heal_ops(
    project_files: dict[str, str],
    compile_log: str = "",
) -> list[dict[str, Any]] | None:
    """
    Correcção determinística de imports shadcn errados (ex.: Label de input.tsx).
    Devolve writes ou None se nada a corrigir.
    """
    merged = dict(project_files or {})
    if not merged:
        return None

    # Prioriza ficheiros mencionados no log de runtime/build
    priority_paths: set[str] = set()
    if compile_log.strip():
        for m in re.finditer(
            r"(?P<path>[\w./\\-]+\.(?:tsx?|jsx?)):(?P<line>\d+)",
            compile_log,
        ):
            raw = m.group("path").replace("\\", "/").lstrip("/")
            for key in merged:
                if key == raw or key.endswith("/" + raw) or raw.endswith(key):
                    priority_paths.add(key.replace("\\", "/"))

    targets = [
        p
        for p in merged
        if p.endswith((".tsx", ".jsx", ".ts", ".js"))
        and (not priority_paths or p.replace("\\", "/") in priority_paths)
    ]
    if not targets and priority_paths:
        targets = list(merged.keys())
    if not targets:
        targets = [p for p in merged if p.endswith((".tsx", ".jsx"))]

    ops: list[dict[str, Any]] = []
    for path in targets:
        content = str(merged.get(path) or "")
        if not content.strip():
            continue
        wrong = validate_shadcn_named_imports(path, content)
        if not wrong and compile_log.strip():
            if not _EXPORT_NAME_ERROR_RE.search(compile_log):
                continue
        fixed, changed = rewrite_shadcn_imports(content)
        if changed:
            ops.append({"op": "write", "path": path, "content": fixed})

    return ops or None
