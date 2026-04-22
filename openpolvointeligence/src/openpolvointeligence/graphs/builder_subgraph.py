"""Sub-grafo LangGraph do Builder (Lovable-like).

Pipeline por defeito (FAST, 4 nodes):

    techlead → engineer → developer → integrator → END

Quando `quality_mode=True` intercala tester + analyzer **em paralelo** entre
developer e integrator (reduz latência vs. os executar em série):

    techlead → engineer → developer → (tester ‖ analyzer) → integrator → END

Cada node faz uma invocação LLM com `response_format=json` e acumula o
resultado no `BuilderState`. O integrador devolve o `artifact` final.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts" / "builder"
_logger = logging.getLogger(__name__)

# Timeouts generosos — cada node pode produzir ficheiros grandes (especialmente
# developer e integrator). Estes valores só se aplicam dentro do sub-grafo.
_BUILDER_NODE_TIMEOUT_S = 180.0  # hard cap por node
_BUILDER_NODE_RETRIES = 1  # uma retry silenciosa em caso de timeout/JSON partido


def _load(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _strip_fence(s: str) -> str:
    s = (s or "").strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = (
                "\n".join(lines[1:-1])
                if lines[-1].strip().startswith("```")
                else "\n".join(lines[1:])
            )
            return inner.strip()
    return s


def _parse_json(raw: str, *, fallback: Any = None) -> Any:
    try:
        return json.loads(_strip_fence(raw))
    except (json.JSONDecodeError, TypeError):
        return fallback if fallback is not None else {}


class BuilderState(TypedDict, total=False):
    user_request: str
    model_provider: str | None
    quality_mode: bool  # True → inclui tester + analyzer em paralelo
    spec: dict[str, Any]
    design: dict[str, Any]
    code_files: list[dict[str, Any]]
    test_report: dict[str, Any]
    review_report: dict[str, Any]
    artifact: dict[str, Any]


def _kit_for(project_type: str) -> str:
    """Concatena os kits de arquitectura relevantes para o project_type."""
    shadcn = _load("kit_shadcn")
    fe = _load("kit_frontend_arch")
    if project_type == "fullstack_node":
        return f"{shadcn}\n\n---\n\n{fe}\n\n---\n\n{_load('kit_node_arch')}"
    if project_type == "fullstack_go_hexagonal":
        return f"{shadcn}\n\n---\n\n{fe}\n\n---\n\n{_load('kit_go_hex_arch')}"
    if project_type == "fullstack_next":
        return f"{shadcn}\n\n---\n\n{_load('kit_next_arch')}"
    if project_type == "landing_page":
        return f"{shadcn}\n\n---\n\n{_load('kit_landing_page')}"
    # frontend_only (default)
    return f"{shadcn}\n\n---\n\n{fe}"


async def _invoke_json(
    settings: Settings,
    provider: str | None,
    system_prompt: str,
    user_payload: dict[str, Any] | str,
    *,
    node_name: str,
    retries: int = _BUILDER_NODE_RETRIES,
) -> Any:
    """Invoca o LLM com timeout dedicado e retry silenciosa.

    Em caso de timeout ou JSON partido, tenta uma vez com a instrução reforçada.
    Se continuar a falhar, devolve dict vazio (o node aplica defaults).
    """
    chat = get_chat_model(settings, provider, json_mode=True)
    user_text = (
        user_payload
        if isinstance(user_payload, str)
        else json.dumps(user_payload, ensure_ascii=False)
    )
    attempts = 0
    last_err: Exception | None = None
    while attempts <= retries:
        attempts += 1
        t0 = time.perf_counter()
        try:
            resp = await asyncio.wait_for(
                chat.ainvoke(
                    [SystemMessage(content=system_prompt), HumanMessage(content=user_text)],
                ),
                timeout=_BUILDER_NODE_TIMEOUT_S,
            )
            dt_ms = int((time.perf_counter() - t0) * 1000)
            raw = str(resp.content)
            data = _parse_json(raw, fallback=None)
            if data is None:
                raise ValueError("JSON inválido")
            _logger.info(
                "builder.%s ok in %dms (%d chars, attempt %d)",
                node_name,
                dt_ms,
                len(raw),
                attempts,
            )
            return data
        except (asyncio.TimeoutError, ValueError, Exception) as exc:
            last_err = exc
            dt_ms = int((time.perf_counter() - t0) * 1000)
            _logger.warning(
                "builder.%s failed after %dms (attempt %d/%d): %s",
                node_name,
                dt_ms,
                attempts,
                retries + 1,
                exc,
            )
            # Reforça a instrução em caso de retry
            if attempts <= retries:
                user_text = (
                    "Gera APENAS um objecto JSON válido conforme o schema do system prompt. "
                    "Se o output anterior falhou, reduz o tamanho dos campos 'content' "
                    "(trunca comentários longos) mas mantém toda a estrutura.\n\n"
                    f"Pedido original:\n{user_text[:8000]}"
                )
    _logger.error("builder.%s esgotou tentativas: %s", node_name, last_err)
    return {}


def build_builder_graph(settings: Settings):
    techlead_sys = _load("techlead_system")
    engineer_sys = _load("engineer_system")
    developer_sys = _load("developer_system")
    tester_sys = _load("tester_system")
    analyzer_sys = _load("code_analyzer_system")
    integrator_sys = _load("integrator_system")

    async def node_techlead(state: BuilderState) -> dict[str, Any]:
        req = state.get("user_request") or ""
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            techlead_sys,
            {"user_request": req},
            node_name="techlead",
        )
        if not isinstance(data, dict):
            data = {}
        data.setdefault("project_type", "frontend_only")
        data.setdefault("name", "app")
        data.setdefault("title", "Aplicação")
        data.setdefault("description", "")
        data.setdefault("features", [])
        data.setdefault("stack", {})
        data.setdefault("recommendations", [])
        data.setdefault("recommendation_reason", "")
        # Valida project_type
        valid_types = {
            "frontend_only",
            "landing_page",
            "fullstack_node",
            "fullstack_next",
            "fullstack_go_hexagonal",
        }
        if data.get("project_type") not in valid_types:
            data["project_type"] = "frontend_only"
        return {"spec": data}

    async def node_engineer(state: BuilderState) -> dict[str, Any]:
        spec = state.get("spec") or {}
        project_type = str(spec.get("project_type") or "frontend_only")
        kit = _kit_for(project_type)
        sys_prompt = engineer_sys + "\n\n---\n\n# Kit arquitectónico de referência\n\n" + kit
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            sys_prompt,
            {"user_request": state.get("user_request", ""), "spec": spec},
            node_name="engineer",
        )
        if not isinstance(data, dict):
            data = {}
        data.setdefault("file_tree", [])
        data.setdefault("modules", [])
        data.setdefault("user_flows", [])
        data.setdefault("edge_cases", [])
        return {"design": data}

    async def node_developer(state: BuilderState) -> dict[str, Any]:
        spec = state.get("spec") or {}
        design = state.get("design") or {}
        project_type = str(spec.get("project_type") or "frontend_only")
        kit = _kit_for(project_type)
        sys_prompt = developer_sys + "\n\n---\n\n# Kit arquitectónico + componentes\n\n" + kit
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            sys_prompt,
            {"spec": spec, "design": design},
            node_name="developer",
        )
        files: list[dict[str, Any]] = []
        if isinstance(data, dict):
            raw_files = data.get("files")
            if isinstance(raw_files, list):
                for f in raw_files:
                    if not isinstance(f, dict):
                        continue
                    p = str(f.get("path", "")).strip()
                    c = f.get("content")
                    if not p or not isinstance(c, str):
                        continue
                    files.append(
                        {
                            "path": p,
                            "language": str(f.get("language", "")).strip() or "text",
                            "content": c,
                        },
                    )
        return {"code_files": files}

    async def node_quality(state: BuilderState) -> dict[str, Any]:
        """Corre tester + analyzer em paralelo (quality_mode)."""
        payload = {
            "spec": state.get("spec", {}),
            "design": state.get("design", {}),
            "files": state.get("code_files", []),
        }
        tester_task = _invoke_json(
            settings,
            state.get("model_provider"),
            tester_sys,
            payload,
            node_name="tester",
        )
        analyzer_payload = {**payload, "test_report": {}}
        analyzer_task = _invoke_json(
            settings,
            state.get("model_provider"),
            analyzer_sys,
            analyzer_payload,
            node_name="analyzer",
        )
        tester_data, analyzer_data = await asyncio.gather(
            tester_task, analyzer_task, return_exceptions=False,
        )
        if not isinstance(tester_data, dict):
            tester_data = {}
        tester_data.setdefault("test_cases", [])
        tester_data.setdefault("bugs", [])
        tester_data.setdefault("coverage_notes", "")
        if not isinstance(analyzer_data, dict):
            analyzer_data = {}
        analyzer_data.setdefault("issues", [])
        analyzer_data.setdefault("must_fix", [])
        analyzer_data.setdefault("nice_to_fix", [])
        analyzer_data.setdefault("overall_score", 0)
        return {"test_report": tester_data, "review_report": analyzer_data}

    async def node_integrator(state: BuilderState) -> dict[str, Any]:
        spec = state.get("spec") or {}
        project_type = str(spec.get("project_type") or "frontend_only")
        kit = _kit_for(project_type)
        sys_prompt = integrator_sys + "\n\n---\n\n# Kit arquitectónico + componentes\n\n" + kit
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            sys_prompt,
            {
                "spec": spec,
                "design": state.get("design", {}),
                "files": state.get("code_files", []),
                "test_report": state.get("test_report", {}),
                "review_report": state.get("review_report", {}),
            },
            node_name="integrator",
        )
        if not isinstance(data, dict):
            data = {}
        title = str(data.get("title") or spec.get("title") or spec.get("name") or "Aplicação").strip()
        description = str(data.get("description") or spec.get("description") or "").strip()
        files = data.get("files")
        if not isinstance(files, list) or not files:
            files = state.get("code_files") or []
        clean_files: list[dict[str, Any]] = []
        for f in files:
            if not isinstance(f, dict):
                continue
            p = str(f.get("path", "")).strip()
            c = f.get("content")
            if not p or not isinstance(c, str):
                continue
            clean_files.append(
                {
                    "path": p,
                    "language": str(f.get("language", "")).strip() or "text",
                    "content": c,
                },
            )
        preview_html = str(data.get("preview_html") or "")
        review_summary = data.get("review_summary")
        if not isinstance(review_summary, dict):
            rr = state.get("review_report") or {}
            tr = state.get("test_report") or {}
            review_summary = {
                "tests_ok": not bool(tr.get("bugs")),
                "issues_fixed": len(rr.get("must_fix") or []),
                "remaining_warnings": [str(x) for x in (rr.get("nice_to_fix") or [])],
            }
        artifact: dict[str, Any] = {
            "title": title,
            "description": description,
            "project_type": project_type,
            "framework": str(data.get("framework") or ""),
            "entry_file": str(data.get("entry_file") or ""),
            "files": clean_files,
            "preview_html": preview_html,
            "review_summary": review_summary,
        }
        # Recomendações vindas do Tech Lead — úteis para o UI mostrar alternativas.
        recs = spec.get("recommendations")
        if isinstance(recs, list) and recs:
            artifact["recommendations"] = recs
        reason = spec.get("recommendation_reason")
        if isinstance(reason, str) and reason.strip():
            artifact["recommendation_reason"] = reason.strip()
        deploy = data.get("deploy_instructions")
        if isinstance(deploy, str) and deploy.strip():
            artifact["deploy_instructions"] = deploy
        return {"artifact": artifact}

    # Routing condicional: quality_mode controla se passa por node_quality
    def route_after_developer(state: BuilderState) -> str:
        return "quality" if state.get("quality_mode") else "integrator"

    g = StateGraph(BuilderState)
    g.add_node("techlead", node_techlead)
    g.add_node("engineer", node_engineer)
    g.add_node("developer", node_developer)
    g.add_node("quality", node_quality)
    g.add_node("integrator", node_integrator)
    g.add_edge(START, "techlead")
    g.add_edge("techlead", "engineer")
    g.add_edge("engineer", "developer")
    g.add_conditional_edges(
        "developer",
        route_after_developer,
        {"quality": "quality", "integrator": "integrator"},
    )
    g.add_edge("quality", "integrator")
    g.add_edge("integrator", END)
    return g.compile()


_compiled: Any = None


def get_compiled_builder_graph(settings: Settings) -> Any:
    global _compiled
    if _compiled is None:
        _compiled = build_builder_graph(settings)
    return _compiled


def reset_builder_cache() -> None:
    global _compiled
    _compiled = None


# Detecta pedido explícito de qualidade extra no request do utilizador.
_QUALITY_KEYWORDS = (
    "qualidade máxima",
    "qualidade maxima",
    "produção",
    "producao",
    "revisão extra",
    "revisao extra",
    "enterprise",
    "pronto para produção",
    "pronto para producao",
)


def _wants_quality(user_request: str) -> bool:
    low = (user_request or "").lower()
    return any(k in low for k in _QUALITY_KEYWORDS)


async def run_builder(
    settings: Settings,
    user_request: str,
    model_provider: str | None = None,
    *,
    quality_mode: bool | None = None,
) -> dict[str, Any]:
    """Executa o sub-grafo e devolve o `artifact` final.

    `quality_mode=None` (default) auto-detecta pelo texto do pedido.
    """
    graph = get_compiled_builder_graph(settings)
    qm = bool(quality_mode) if quality_mode is not None else _wants_quality(user_request)
    t0 = time.perf_counter()
    try:
        out = await graph.ainvoke(
            {
                "user_request": user_request or "",
                "model_provider": model_provider,
                "quality_mode": qm,
            },
        )
    except Exception as exc:  # noqa: BLE001 — último fallback
        _logger.exception("builder graph falhou: %s", exc)
        return _empty_artifact(str(exc))
    dt = time.perf_counter() - t0
    _logger.info(
        "builder concluído em %.1fs (quality_mode=%s)", dt, qm,
    )
    artifact = out.get("artifact") if isinstance(out, dict) else None
    if not isinstance(artifact, dict):
        return _empty_artifact("artifact vazio")
    return artifact


async def run_builder_stream(
    settings: Settings,
    user_request: str,
    model_provider: str | None = None,
):
    """Executa o builder nó a nó emitindo eventos SSE após cada fase.

    Estratégia Lovable: cada nó emite progresso + ficheiros individuais à medida que
    são gerados, sem bloquear até ao fim. Elimina o timeout HTTP.

    Yields dicts com `type` em: "progress" | "file" | "node_done" | "done" | "error".
    """
    techlead_sys = _load("techlead_system")
    engineer_sys = _load("engineer_system")
    developer_sys = _load("developer_system")
    integrator_sys = _load("integrator_system")

    t0 = time.perf_counter()

    # ── Node: techlead ──────────────────────────────────────────────────────────
    yield {"type": "progress", "step": "techlead", "label": "Tech Lead a definir arquitetura e stack..."}
    spec = await _invoke_json(
        settings, model_provider, techlead_sys,
        {"user_request": user_request or ""},
        node_name="techlead",
    )
    if not isinstance(spec, dict):
        spec = {}
    spec.setdefault("project_type", "frontend_only")
    spec.setdefault("name", "app")
    spec.setdefault("title", "Aplicação")
    spec.setdefault("description", "")
    spec.setdefault("features", [])
    spec.setdefault("stack", {})
    spec.setdefault("recommendations", [])
    spec.setdefault("recommendation_reason", "")
    valid_types = {"frontend_only", "landing_page", "fullstack_node", "fullstack_next", "fullstack_go_hexagonal"}
    if spec.get("project_type") not in valid_types:
        spec["project_type"] = "frontend_only"
    yield {"type": "node_done", "node": "techlead"}

    # ── Node: engineer ──────────────────────────────────────────────────────────
    project_type = str(spec.get("project_type") or "frontend_only")
    kit = _kit_for(project_type)
    sys_eng = engineer_sys + "\n\n---\n\n# Kit arquitectónico de referência\n\n" + kit
    yield {"type": "progress", "step": "engineer", "label": "Engenheiro a planear estrutura de ficheiros..."}
    design = await _invoke_json(
        settings, model_provider, sys_eng,
        {"user_request": user_request or "", "spec": spec},
        node_name="engineer",
    )
    if not isinstance(design, dict):
        design = {}
    design.setdefault("file_tree", [])
    design.setdefault("modules", [])
    design.setdefault("user_flows", [])
    design.setdefault("edge_cases", [])
    yield {"type": "node_done", "node": "engineer"}

    # ── Node: developer ─────────────────────────────────────────────────────────
    sys_dev = developer_sys + "\n\n---\n\n# Kit arquitectónico + componentes\n\n" + kit
    yield {"type": "progress", "step": "developer", "label": "Programador a gerar código dos ficheiros..."}
    dev_data = await _invoke_json(
        settings, model_provider, sys_dev,
        {"spec": spec, "design": design},
        node_name="developer",
    )
    files: list[dict[str, Any]] = []
    if isinstance(dev_data, dict):
        raw_files = dev_data.get("files")
        if isinstance(raw_files, list):
            for f in raw_files:
                if not isinstance(f, dict):
                    continue
                p = str(f.get("path", "")).strip()
                c = f.get("content")
                if not p or not isinstance(c, str):
                    continue
                entry = {
                    "path": p,
                    "language": str(f.get("language", "")).strip() or "text",
                    "content": c,
                }
                files.append(entry)
                yield {"type": "file", "file": entry}
    yield {"type": "node_done", "node": "developer"}

    # ── Node: integrator ────────────────────────────────────────────────────────
    sys_int = integrator_sys + "\n\n---\n\n# Kit arquitectónico + componentes\n\n" + kit
    yield {"type": "progress", "step": "integrator", "label": "Integrador a rever e finalizar projecto..."}
    int_data = await _invoke_json(
        settings, model_provider, sys_int,
        {
            "spec": spec,
            "design": design,
            "files": files,
            "test_report": {},
            "review_report": {},
        },
        node_name="integrator",
    )
    if not isinstance(int_data, dict):
        int_data = {}

    # Montar artifact (mesma lógica do node_integrator original)
    title = str(int_data.get("title") or spec.get("title") or spec.get("name") or "Aplicação").strip()
    description = str(int_data.get("description") or spec.get("description") or "").strip()
    int_files = int_data.get("files")
    if isinstance(int_files, list) and int_files:
        clean_files: list[dict[str, Any]] = []
        for f in int_files:
            if not isinstance(f, dict):
                continue
            p = str(f.get("path", "")).strip()
            c = f.get("content")
            if not p or not isinstance(c, str):
                continue
            clean_files.append({
                "path": p,
                "language": str(f.get("language", "")).strip() or "text",
                "content": c,
            })
        if clean_files:
            files = clean_files
    preview_html = str(int_data.get("preview_html") or "")
    review_summary: dict[str, Any] = {
        "tests_ok": True,
        "issues_fixed": 0,
        "remaining_warnings": [],
    }
    rs = int_data.get("review_summary")
    if isinstance(rs, dict):
        review_summary = {
            "tests_ok": bool(rs.get("tests_ok", True)),
            "issues_fixed": int(rs.get("issues_fixed") or 0),
            "remaining_warnings": [str(x) for x in (rs.get("remaining_warnings") or [])],
        }
    artifact: dict[str, Any] = {
        "title": title,
        "description": description,
        "project_type": project_type,
        "framework": str(int_data.get("framework") or ""),
        "entry_file": str(int_data.get("entry_file") or ""),
        "files": files,
        "preview_html": preview_html,
        "review_summary": review_summary,
    }
    recs = spec.get("recommendations")
    if isinstance(recs, list) and recs:
        artifact["recommendations"] = recs
    reason = spec.get("recommendation_reason")
    if isinstance(reason, str) and reason.strip():
        artifact["recommendation_reason"] = reason.strip()
    deploy = int_data.get("deploy_instructions")
    if isinstance(deploy, str) and deploy.strip():
        artifact["deploy_instructions"] = deploy

    dt = time.perf_counter() - t0
    _logger.info("builder stream concluído em %.1fs", dt)
    yield {"type": "done", "artifact": artifact}


def _empty_artifact(reason: str) -> dict[str, Any]:
    return {
        "title": "Aplicação",
        "description": f"Não foi possível gerar a aplicação: {reason}",
        "project_type": "frontend_only",
        "framework": "",
        "entry_file": "",
        "files": [],
        "preview_html": "",
        "review_summary": {
            "tests_ok": False,
            "issues_fixed": 0,
            "remaining_warnings": [reason],
        },
    }
