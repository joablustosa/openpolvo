"""Orquestrador — decompõe plano aprovado em build_tasks ordenadas."""

from __future__ import annotations

import re
from typing import Any

_IMPORT_RE = re.compile(
    r"""import\s+(?:\{[^}]*\}|[\w\s,*]+)\s+from\s+['"]([^'"]+)['"]""",
    re.MULTILINE,
)


def _norm_path(p: str) -> str:
    return str(p).strip().replace("\\", "/").lstrip("/")


def _src_prefixes(known_paths: set[str]) -> list[str]:
    if any(p.startswith("frontend/src/") for p in known_paths):
        return ["frontend/src/"]
    return ["src/"]


def _path_from_import(spec: str, known_paths: set[str] | None = None) -> str | None:
    spec = spec.strip()
    if spec.startswith("@/"):
        rel = spec[2:]
        prefixes = _src_prefixes(known_paths or set())
        for prefix in prefixes:
            base = f"{prefix}{rel}"
            if not rel.endswith((".tsx", ".ts", ".jsx", ".js")):
                return f"{base}.tsx"
            return base
    if spec.startswith("./") or spec.startswith("../"):
        return None
    return None


def _extract_local_deps(content: str, known_paths: set[str]) -> list[str]:
    deps: list[str] = []
    for m in _IMPORT_RE.finditer(content or ""):
        spec = m.group(1)
        if spec.startswith(".") or spec.startswith("@/"):
            resolved = _resolve_import_to_path(spec, known_paths)
            if resolved and resolved in known_paths:
                deps.append(resolved)
    return deps


def _resolve_import_to_path(spec: str, known_paths: set[str]) -> str | None:
    if spec.startswith("@/"):
        rel = spec[2:]
        for prefix in _src_prefixes(known_paths):
            base = f"{prefix}{rel}"
            for cand in (base, f"{base}.tsx", f"{base}.ts", f"{base}/index.tsx"):
                if cand in known_paths:
                    return cand
            return _norm_path(f"{base}.tsx")
    return None


def build_tasks_from_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Fallback determinístico: gera build_tasks a partir do plano sem LLM."""
    create = [_norm_path(p) for p in (plan.get("files_to_create") or []) if p]
    modify = [_norm_path(p) for p in (plan.get("files_to_modify") or []) if p]
    all_paths = list(dict.fromkeys(create + modify))
    known = set(all_paths)
    project_files = plan.get("_project_files") or {}
    if isinstance(project_files, dict):
        known.update(_norm_path(k) for k in project_files)

    tasks: list[dict[str, Any]] = []
    for path in create:
        tasks.append(
            {
                "order": 0,
                "path": path,
                "action": "create",
                "depends_on": [],
                "summary": f"Criar {path}",
                "expected_exports": ["default"],
            },
        )
    for path in modify:
        content = project_files.get(path, "") if isinstance(project_files, dict) else ""
        deps = _extract_local_deps(str(content), known)
        tasks.append(
            {
                "order": 0,
                "path": path,
                "action": "modify",
                "depends_on": [d for d in deps if d != path],
                "summary": f"Modificar {path}",
                "expected_exports": ["default"],
            },
        )

    return topological_sort_tasks(tasks)


def normalize_build_tasks(raw: Any, plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Normaliza resposta LLM ou fallback determinístico."""
    if not isinstance(raw, list) or not raw:
        fallback_plan = {**plan, "_project_files": plan.get("_project_files")}
        return build_tasks_from_plan(fallback_plan)

    allowed = set(
        _norm_path(p)
        for p in (plan.get("files_to_create") or []) + (plan.get("files_to_modify") or [])
        if p
    )
    tasks: list[dict[str, Any]] = []
    for i, row in enumerate(raw[:20]):
        if not isinstance(row, dict):
            continue
        path = _norm_path(str(row.get("path") or ""))
        if not path or (allowed and path not in allowed):
            continue
        action = str(row.get("action") or "create").lower()
        if action not in ("create", "modify", "patch"):
            action = "create" if path in (plan.get("files_to_create") or []) else "modify"
        deps_raw = row.get("depends_on") or []
        depends_on = [_norm_path(str(d)) for d in deps_raw if d and _norm_path(str(d)) in allowed]
        tasks.append(
            {
                "order": int(row.get("order") or i + 1),
                "path": path,
                "action": action,
                "depends_on": depends_on,
                "summary": str(row.get("summary") or f"{action} {path}")[:200],
                "expected_exports": row.get("expected_exports")
                if isinstance(row.get("expected_exports"), list)
                else ["default"],
            },
        )

    if not tasks:
        return build_tasks_from_plan(plan)
    return topological_sort_tasks(tasks)


def topological_sort_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ordena tarefas por dependências (leaf-first)."""
    by_path = {t["path"]: t for t in tasks if t.get("path")}
    if not by_path:
        return tasks

    visited: set[str] = set()
    ordered: list[dict[str, Any]] = []

    def visit(path: str) -> None:
        if path in visited or path not in by_path:
            return
        visited.add(path)
        task = by_path[path]
        for dep in task.get("depends_on") or []:
            visit(str(dep))
        ordered.append(task)

    for path in by_path:
        visit(path)

    for i, t in enumerate(ordered):
        t["order"] = i + 1
    return ordered


def validate_orchestration(
    build_tasks: list[dict[str, Any]],
    plan: dict[str, Any],
) -> tuple[bool, list[str]]:
    """Validação determinística do orquestrador."""
    errors: list[str] = []
    plan_paths = set(
        _norm_path(p)
        for p in (plan.get("files_to_create") or []) + (plan.get("files_to_modify") or [])
        if p
    )
    task_paths = {t["path"] for t in build_tasks if t.get("path")}

    if plan_paths and not task_paths.issuperset(plan_paths):
        missing = plan_paths - task_paths
        errors.append(f"tarefas em falta para: {', '.join(sorted(missing)[:5])}")

    for t in build_tasks:
        path = t.get("path", "")
        if "layout/" in path:
            errors.append(f"tarefa inclui layout scaffold: {path}")

    if not build_tasks and plan_paths:
        errors.append("nenhuma build_task gerada")

    return len(errors) == 0, errors


def build_orchestrator_human_suffix(state: dict[str, Any]) -> str:
    plan = state.get("plan") or {}
    return (
        f"\n\n## Plano aprovado\n"
        f"criar: {plan.get('files_to_create') or []}\n"
        f"modificar: {plan.get('files_to_modify') or []}\n"
        f"feature: {plan.get('feature') or ''}\n"
        f"design_tokens: {plan.get('design_tokens') or {}}\n"
    )
