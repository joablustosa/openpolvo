"""Context_Manager — mapa compacto + instruções diff (economia de tokens).

Extracção estrutural determinística (zero tokens) + um único passo LLM para
comprimir conversa, mapa de contratos/rotas/assinaturas e diffs estilo Git.
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_state import (
    FileRef,
    infer_lang,
    manifest_from_tree,
)
from openpolvointeligence.graphs.message_utils import last_user_text, tail_messages
from openpolvointeligence.graphs.models import get_chat_model

_PROMPT_NAME = "dev_workflow_context_system"

# Ficheiros prioritários para indexação estrutural (ordem de relevância)
_PRIORITY_PATHS = (
    "package.json",
    "go.mod",
    "src/main.tsx",
    "src/main.ts",
    "src/App.tsx",
    "src/app/app.component.ts",
    "src/app/app.routes.ts",
    "app/page.tsx",
    "pages/index.tsx",
    "cmd/",
    "internal/",
    "routes/",
    "api/",
)

MAX_INDEX_FILES = 60
MAX_FILE_BYTES_FOR_INDEX = 48_000
MAX_CHAT_CHARS = 12_000


def _load_context_system_prompt() -> str:
    from pathlib import Path

    p = Path(__file__).resolve().parent.parent.parent / "prompts" / f"{_PROMPT_NAME}.md"
    return p.read_text(encoding="utf-8")


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        parts = s.split("\n")
        if len(parts) >= 2:
            inner = (
                "\n".join(parts[1:-1])
                if parts[-1].strip().startswith("```")
                else "\n".join(parts[1:])
            )
            return inner.strip()
    return s


def _parse_json_object(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


def extract_file_structure(path: str, content: str) -> dict[str, Any]:
    """Extrai contratos/assinaturas/rotas sem corpos de função (zero LLM)."""
    lang = infer_lang(path)
    exports: list[str] = []
    signatures: list[str] = []
    routes: list[str] = []
    types: list[str] = []

    if lang in ("ts", "tsx", "js"):
        for m in re.finditer(
            r"export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)"
            r"(?:\s*:\s*([^{;\n]+))?",
            content,
        ):
            ret = (m.group(3) or "").strip()
            sig = f"export function {m.group(1)}({m.group(2).strip()})"
            if ret:
                sig += f": {ret[:80]}"
            signatures.append(sig[:200])
        for m in re.finditer(
            r"export\s+(?:const|let)\s+(\w+)\s*(?::\s*([^=]+))?\s*=",
            content,
        ):
            typ = (m.group(2) or "const").strip()[:60]
            exports.append(f"{m.group(1)}: {typ}")
        for m in re.finditer(r"export\s+(?:type|interface)\s+(\w+)", content):
            types.append(m.group(1))
        for m in re.finditer(
            r"(?:router|app|r)\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]+)",
            content,
            re.I,
        ):
            routes.append(f"{m.group(1).upper()} {m.group(2)}")
        for m in re.finditer(r"<Route\s+[^>]*path=['\"]([^'\"]+)", content):
            routes.append(f"Route {m.group(1)}")

    if lang == "go":
        for m in re.finditer(
            r"func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*(\([^)]*\))?\s*(?:\{|$)",
            content,
        ):
            sig = f"func {m.group(1)}({m.group(2).strip()})"
            if m.group(3):
                sig += f" {m.group(3).strip()}"
            signatures.append(sig[:200])
        for m in re.finditer(
            r"(?:HandleFunc|Handle|Get|Post|Put|Delete)\s*\(\s*\"([^\"]+)\"",
            content,
        ):
            routes.append(m.group(1))

    if path.endswith("package.json"):
        try:
            pkg = json.loads(content)
            deps = list((pkg.get("dependencies") or {}).keys())[:12]
            if deps:
                exports.append(f"deps: {', '.join(deps)}")
        except json.JSONDecodeError:
            pass

    return {
        "path": path,
        "lang": lang,
        "exports": exports[:15],
        "signatures": signatures[:25],
        "types": types[:15],
        "routes": routes[:20],
    }


def prioritize_paths(tree: list[str]) -> list[str]:
    """Ordena paths: config + entrypoints primeiro."""
    if not tree:
        return []

    def score(p: str) -> tuple[int, str]:
        pl = p.lower().replace("\\", "/")
        s = 100
        for i, pref in enumerate(_PRIORITY_PATHS):
            if pl == pref.rstrip("/") or pl.startswith(pref):
                s = i
                break
        if pl.endswith((".tsx", ".ts", ".go")):
            s -= 0.5
        return (int(s * 10), pl)

    return sorted(set(tree), key=score)[:MAX_INDEX_FILES]


def build_structural_index(
    file_tree: list[str],
    project_files: dict[str, str] | None,
) -> dict[str, Any]:
    """Índice estrutural local — não envia corpos ao LLM."""
    files = project_files or {}
    ordered = prioritize_paths(file_tree or list(files.keys()))
    indexed: dict[str, Any] = {}
    for path in ordered:
        body = files.get(path, "")
        if body and len(body.encode("utf-8")) > MAX_FILE_BYTES_FOR_INDEX:
            body = body[:MAX_FILE_BYTES_FOR_INDEX]
        if body:
            indexed[path] = extract_file_structure(path, body)
        else:
            indexed[path] = {
                "path": path,
                "lang": infer_lang(path),
                "exports": [],
                "signatures": [],
                "types": [],
                "routes": [],
                "note": "conteúdo não disponível neste turno",
            }
    return {
        "tree_count": len(file_tree or []),
        "indexed_count": len(indexed),
        "files": indexed,
    }


def format_chat_history(messages: list[dict[str, Any]]) -> str:
    capped = tail_messages(messages)
    lines: list[str] = []
    total = 0
    for m in capped[-12:]:
        role = str(m.get("role", "?")).strip()
        text = str(m.get("content", "")).strip().replace("\n", " ")[:600]
        line = f"[{role}] {text}"
        if total + len(line) > MAX_CHAT_CHARS:
            break
        lines.append(line)
        total += len(line)
    return "\n".join(lines)


def _fallback_conversation_digest(messages: list[dict[str, Any]]) -> str:
    capped = tail_messages(messages)
    return "\n".join(
        f"- {m.get('role', '?')}: {str(m.get('content', ''))[:180]}" for m in capped[-6:]
    )


def _normalize_compact_context_map(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {
        "stack": str(raw.get("stack") or "")[:40] or None,
        "api_contracts": [],
        "module_signatures": [],
        "routes": [],
        "recent_decisions": [],
    }
    for key, target in (
        ("api_contracts", "api_contracts"),
        ("module_signatures", "module_signatures"),
        ("routes", "routes"),
        ("recent_decisions", "recent_decisions"),
    ):
        val = raw.get(key)
        if isinstance(val, list):
            out[target] = [x for x in val[:30] if x is not None]
    return out


def _normalize_diff_instructions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw[:25]:
        if not isinstance(row, dict):
            continue
        path = str(row.get("path") or "").strip().replace("\\", "/")
        if not path or ".." in path:
            continue
        entry: dict[str, Any] = {
            "path": path,
            "change_type": str(row.get("change_type") or "patch")[:20],
            "rationale": str(row.get("rationale") or "")[:300],
        }
        diff = row.get("unified_diff")
        if isinstance(diff, str) and diff.strip():
            entry["unified_diff"] = diff.strip()[:12000]
        hunks = row.get("hunks")
        if isinstance(hunks, list):
            entry["hunks"] = hunks[:12]
        out.append(entry)
    return out


def apply_unified_diff(original: str, diff: str) -> str | None:
    """Aplica unified diff simplificado (estilo git patch)."""
    if not diff.strip():
        return None

    lines = original.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] = lines[-1] + "\n"

    out_lines: list[str] = []
    src_idx = 0
    in_hunk = False
    hunk_old = 0

    for raw_line in diff.splitlines():
        if raw_line.startswith("@@"):
            m = re.match(r"@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@", raw_line)
            if m:
                target = max(0, int(m.group(1)) - 1)
                while src_idx < target and src_idx < len(lines):
                    out_lines.append(lines[src_idx])
                    src_idx += 1
                hunk_old = src_idx
                in_hunk = True
            continue
        if not in_hunk:
            continue
        if raw_line.startswith("---") or raw_line.startswith("+++"):
            continue
        if raw_line.startswith(" "):
            if src_idx < len(lines):
                out_lines.append(lines[src_idx])
                src_idx += 1
        elif raw_line.startswith("-"):
            src_idx += 1
        elif raw_line.startswith("+"):
            add = raw_line[1:]
            if not add.endswith("\n"):
                add += "\n"
            out_lines.append(add)
        elif raw_line.startswith("\\"):
            continue

    while src_idx < len(lines):
        out_lines.append(lines[src_idx])
        src_idx += 1

    result = "".join(out_lines)
    if hunk_old == 0 and not result.strip():
        return None
    return result.rstrip("\n") + ("\n" if original.endswith("\n") else "")


def diff_instructions_to_writes(
    diff_instructions: list[dict[str, Any]],
    project_files: dict[str, str],
) -> list[dict[str, Any]]:
    """Converte diffs em operações write para o Electron."""
    writes: list[dict[str, Any]] = []
    for instr in diff_instructions:
        path = str(instr.get("path", "")).strip()
        if not path:
            continue
        change = str(instr.get("change_type") or "patch").lower()
        if change == "create":
            body = instr.get("new_file_content") or instr.get("content")
            if isinstance(body, str):
                writes.append({"op": "write", "path": path, "content": body})
            continue
        if change == "delete":
            continue
        base = project_files.get(path, "")
        diff = instr.get("unified_diff")
        if isinstance(diff, str) and diff.strip() and base:
            patched = apply_unified_diff(base, diff)
            if patched is not None:
                writes.append({"op": "write", "path": path, "content": patched})
    return writes


async def run_context_manager(
    settings: Settings,
    *,
    messages: list[dict[str, Any]],
    model_provider: str | None,
    file_tree: list[str] | None = None,
    project_files: dict[str, str] | None = None,
    file_manifest: list[FileRef] | None = None,
    previous_context_map: dict[str, Any] | None = None,
    preview_console_block: str | None = None,
    user_prompt: str | None = None,
) -> dict[str, Any]:
    """Executa o nó Context_Manager e devolve mapa compacto + diffs."""
    prompt_text = user_prompt or last_user_text(messages, 4000)
    structural = build_structural_index(file_tree or [], project_files)
    chat_block = format_chat_history(messages)

    human_parts = [
        f"## Pedido actual\n{prompt_text}",
        f"## Histórico de chat\n{chat_block}",
        f"## Árvore de ficheiros ({structural['tree_count']} paths, indexados: {structural['indexed_count']})",
        json.dumps(
            [p for p in (file_tree or [])[:80]],
            ensure_ascii=False,
        ),
        "## Índice estrutural (sem corpos de código)\n"
        + json.dumps(structural["files"], ensure_ascii=False)[:14000],
    ]
    if previous_context_map:
        human_parts.append(
            "## Mapa de contexto anterior\n"
            + json.dumps(previous_context_map, ensure_ascii=False)[:4000],
        )
    if preview_console_block:
        human_parts.append(f"## Preview / build\n{preview_console_block[:3000]}")

    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke(
        [
            SystemMessage(content=_load_context_system_prompt()),
            HumanMessage(content="\n\n".join(human_parts)),
        ],
    )
    data = _parse_json_object(str(resp.content))

    conv = str(data.get("conversation_digest") or "").strip()
    if not conv:
        conv = _fallback_conversation_digest(messages)

    compact = _normalize_compact_context_map(data.get("compact_context_map"))
    if not compact.get("stack") and structural["files"]:
        for p in ("package.json", "go.mod"):
            if p in structural["files"]:
                compact["stack"] = "detected-from-tree"
                break

    diff_instructions = _normalize_diff_instructions(data.get("diff_instructions"))
    use_diff = bool(data.get("use_diff_mode")) and bool(diff_instructions)

    # Classificação determinística preliminar (router refina depois com hint do LLM).
    from openpolvointeligence.graphs.dev_workflow.dev_workflow_request_kind import (
        classify_request_kind,
        prefers_diff_mode,
    )

    has_project = bool(project_files) or bool(file_tree)
    has_build_errors = bool((preview_console_block or "").strip())
    prelim_kind = classify_request_kind(
        prompt_text,
        has_project=has_project,
        has_build_errors=has_build_errors,
    )
    # Nova app reconstrói (sem diff); bug_fix/feature pequena preferem patch incremental.
    if prelim_kind == "new_app":
        use_diff = False
        diff_instructions = []
    elif prelim_kind in ("bug_fix", "feature") and not prefers_diff_mode(prelim_kind):
        use_diff = use_diff and bool(diff_instructions)

    project_digest = str(data.get("project_digest") or "").strip()
    if not project_digest:
        project_digest = json.dumps(compact, ensure_ascii=False)[:2000]

    manifest = list(file_manifest or [])
    if not manifest and file_tree:
        manifest = manifest_from_tree(file_tree, project_files or {})

    return {
        "user_prompt": prompt_text,
        "conversation_digest": conv[:2500],
        "project_digest": project_digest[:2500],
        "compact_context_map": compact,
        "diff_instructions": diff_instructions,
        "use_diff_mode": use_diff,
        "request_kind": prelim_kind,
        "file_manifest": manifest,
        "structural_index": structural,
    }
