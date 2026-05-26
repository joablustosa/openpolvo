"""Code_Generator — aplica patches estruturados e converte em writes."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.graphs.preview_source_sanitize import sanitize_write_op

MAX_FULL_WRITE_LINES = 80
MAX_PATCHES_PER_FILE = 12


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def number_file_excerpt(content: str, max_lines: int = 400) -> str:
    """Excerpt com números de linha para o LLM ancorar old_text."""
    lines = content.splitlines()
    if len(lines) > max_lines:
        head = lines[: max_lines // 2]
        tail = lines[-(max_lines // 2) :]
        numbered = [f"{i + 1:4d}| {ln}" for i, ln in enumerate(head)]
        numbered.append("     | ... (ficheiro truncado) ...")
        offset = len(lines) - len(tail)
        numbered.extend(f"{offset + i + 1:4d}| {ln}" for i, ln in enumerate(tail))
        return "\n".join(numbered)
    return "\n".join(f"{i + 1:4d}| {ln}" for i, ln in enumerate(lines))


def build_codegen_file_excerpts(
    plan: dict[str, Any],
    project_files: dict[str, str],
    *,
    max_files: int = 8,
    max_lines_per_file: int = 350,
) -> str:
    """Injecta excertos numerados só dos ficheiros a modificar."""
    modify = [str(p) for p in (plan.get("files_to_modify") or []) if p]
    create = set(_norm_path(p) for p in (plan.get("files_to_create") or []))
    blocks: list[str] = []
    for raw in modify[:max_files]:
        path = _norm_path(raw)
        if path in create:
            continue
        body = project_files.get(path) or project_files.get(raw)
        if not body:
            blocks.append(f"### {path}\n(conteúdo não enviado — use patch com old_text do mapa compacto)\n")
            continue
        line_count = body.count("\n") + 1
        blocks.append(
            f"### {path} ({line_count} linhas)\n```\n"
            f"{number_file_excerpt(body, max_lines_per_file)}\n```\n",
        )
    if not blocks:
        return "(sem excertos — projecto novo ou só ficheiros a criar)\n"
    return "\n".join(blocks)


def apply_structured_patch(content: str, patch: dict[str, Any]) -> tuple[str | None, str | None]:
    """Aplica um hunk; exige old_text presente no ficheiro."""
    old_text = patch.get("old_text")
    if old_text is None or str(old_text) == "":
        return None, "patch sem old_text (obrigatório para anti-alucinação)"
    old_s = str(old_text)
    new_s = str(patch.get("new_text") if patch.get("new_text") is not None else "")

    if old_s not in content:
        return None, f"old_text não encontrado: {old_s[:80]!r}..."

    count = content.count(old_s)
    if count > 1:
        start = int(patch.get("start_line") or 0)
        end = int(patch.get("end_line") or start)
        if start > 0:
            lines = content.splitlines(keepends=True)
            chunk = "".join(lines[start - 1 : end])
            if old_s in chunk and chunk.count(old_s) == 1:
                new_chunk = chunk.replace(old_s, new_s, 1)
                return "".join(lines[: start - 1]) + new_chunk + "".join(lines[end:]), None
        return None, f"old_text ambíguo ({count} ocorrências) — refine o anchor"

    return content.replace(old_s, new_s, 1), None


def apply_patches_to_file(content: str, patches: list[dict[str, Any]]) -> tuple[str | None, list[str]]:
    """Aplica hunks ordenados de baixo para cima (start_line desc)."""
    errors: list[str] = []
    sorted_patches = sorted(
        patches,
        key=lambda p: int(p.get("start_line") or 0),
        reverse=True,
    )
    current = content
    for i, patch in enumerate(sorted_patches[:MAX_PATCHES_PER_FILE]):
        next_content, err = apply_structured_patch(current, patch)
        if err:
            errors.append(f"patch[{i}]: {err}")
            continue
        if next_content is not None:
            current = next_content
    if errors and current == content:
        return None, errors
    return current, errors


def _allow_full_write(
    path: str,
    content: str,
    *,
    files_to_create: set[str],
    file_exists: bool,
    force: bool,
) -> tuple[bool, str | None]:
    if force:
        return True, None
    norm = _norm_path(path)
    if norm in files_to_create or not file_exists:
        return True, None
    line_count = content.count("\n") + 1 if content else 0
    if line_count <= MAX_FULL_WRITE_LINES:
        return True, None
    return False, (
        f"write completo rejeitado em {path} ({line_count} linhas) — use op patch"
    )


def resolve_codegen_operations(
    operations: list[dict[str, Any]],
    project_files: dict[str, str],
    plan: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Converte patch/mkdir/write LLM → operações write/mkdir para o Electron.
    Patches aplicados localmente; validação anti-alucinação via old_text.
    """
    plan = plan or {}
    files_to_create = {_norm_path(p) for p in (plan.get("files_to_create") or []) if p}
    files_to_modify = {_norm_path(p) for p in (plan.get("files_to_modify") or []) if p}
    allowed_paths = files_to_create | files_to_modify

    resolved: list[dict[str, Any]] = []
    errors: list[str] = []

    for idx, op in enumerate(operations):
        if not isinstance(op, dict):
            errors.append(f"op[{idx}] inválida")
            continue
        kind = str(op.get("op", "")).strip().lower()
        path = _norm_path(str(op.get("path", "")))
        if not path or ".." in path:
            errors.append(f"op[{idx}] path inválido")
            continue
        if allowed_paths and path not in allowed_paths:
            errors.append(f"op[{idx}] path fora do plano: {path}")
            continue

        if kind == "mkdir":
            resolved.append({"op": "mkdir", "path": path})
            continue

        if kind == "patch":
            patches = op.get("patches")
            if not isinstance(patches, list) or not patches:
                errors.append(f"op[{idx}] patch sem hunks")
                continue
            base = project_files.get(path, "")
            if not base:
                errors.append(f"op[{idx}] patch em {path} sem conteúdo base no project_files")
                continue
            patched, patch_errs = apply_patches_to_file(base, patches)
            errors.extend(patch_errs)
            if patched is None:
                continue
            resolved.append(
                {
                    "op": "write",
                    "path": path,
                    "content": sanitize_write_op(path, patched),
                },
            )
            continue

        if kind == "write":
            content = sanitize_write_op(
                path,
                str(op.get("content") if op.get("content") is not None else ""),
            )
            exists = path in project_files and bool(project_files.get(path))
            ok, reason = _allow_full_write(
                path,
                content,
                files_to_create=files_to_create,
                file_exists=exists,
                force=bool(op.get("force_full_write")),
            )
            if not ok:
                errors.append(reason or f"op[{idx}] write rejeitado")
                continue
            resolved.append({"op": "write", "path": path, "content": content})
            continue

        errors.append(f"op[{idx}] op desconhecida: {kind}")

    return resolved, errors
