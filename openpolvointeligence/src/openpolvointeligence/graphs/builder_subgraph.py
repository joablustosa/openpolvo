"""Sub-grafo LangGraph do Builder (Lovable-like): 6 nodes especializados.

Pipeline linear:

    techlead → engineer → developer → tester → code_analyzer → integrator → END

Cada node faz **uma** invocação LLM com `response_format=json` e acumula o
resultado no `BuilderState`. O integrador devolve o `artifact` final:
`{title, description, project_type, framework, entry_file, files[], preview_html, deploy_instructions?, review_summary}`
que é colocado em `metadata.builder` na mensagem do assistente.
"""

from __future__ import annotations

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


def _parse_json(raw: str, *, fallback: dict[str, Any] | list[Any] | None = None) -> Any:
    try:
        return json.loads(_strip_fence(raw))
    except (json.JSONDecodeError, TypeError):
        return fallback if fallback is not None else {}


class BuilderState(TypedDict, total=False):
    user_request: str
    model_provider: str | None
    # Outputs acumulados
    spec: dict[str, Any]
    design: dict[str, Any]
    code_files: list[dict[str, Any]]
    test_report: dict[str, Any]
    review_report: dict[str, Any]
    artifact: dict[str, Any]


def _kit_for(project_type: str) -> str:
    """Concatena os kits de arquitectura relevantes para o project_type."""
    shadcn = _load("kit_shadcn")
    if project_type == "fullstack_node":
        return shadcn + "\n\n---\n\n" + _load("kit_frontend_arch") + "\n\n---\n\n" + _load("kit_node_arch")
    if project_type == "fullstack_go_hexagonal":
        return shadcn + "\n\n---\n\n" + _load("kit_frontend_arch") + "\n\n---\n\n" + _load("kit_go_hex_arch")
    # frontend_only (default)
    return shadcn + "\n\n---\n\n" + _load("kit_frontend_arch")


async def _invoke_json(
    settings: Settings,
    provider: str | None,
    system_prompt: str,
    user_payload: dict[str, Any] | str,
    *,
    node_name: str,
) -> Any:
    chat = get_chat_model(settings, provider, json_mode=True)
    if isinstance(user_payload, str):
        user_text = user_payload
    else:
        user_text = json.dumps(user_payload, ensure_ascii=False)
    t0 = time.perf_counter()
    resp = await chat.ainvoke(
        [SystemMessage(content=system_prompt), HumanMessage(content=user_text)],
    )
    dt_ms = int((time.perf_counter() - t0) * 1000)
    raw = str(resp.content)
    _logger.info("builder.%s ok in %dms (%d chars)", node_name, dt_ms, len(raw))
    return _parse_json(raw)


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
        # Defaults defensivos
        data.setdefault("project_type", "frontend_only")
        data.setdefault("name", "app")
        data.setdefault("title", "Aplicação")
        data.setdefault("description", "")
        data.setdefault("features", [])
        data.setdefault("stack", {})
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

    async def node_tester(state: BuilderState) -> dict[str, Any]:
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            tester_sys,
            {
                "spec": state.get("spec", {}),
                "design": state.get("design", {}),
                "files": state.get("code_files", []),
            },
            node_name="tester",
        )
        if not isinstance(data, dict):
            data = {}
        data.setdefault("test_cases", [])
        data.setdefault("bugs", [])
        data.setdefault("coverage_notes", "")
        return {"test_report": data}

    async def node_analyzer(state: BuilderState) -> dict[str, Any]:
        data = await _invoke_json(
            settings,
            state.get("model_provider"),
            analyzer_sys,
            {
                "spec": state.get("spec", {}),
                "design": state.get("design", {}),
                "files": state.get("code_files", []),
                "test_report": state.get("test_report", {}),
            },
            node_name="analyzer",
        )
        if not isinstance(data, dict):
            data = {}
        data.setdefault("issues", [])
        data.setdefault("must_fix", [])
        data.setdefault("nice_to_fix", [])
        data.setdefault("overall_score", 0)
        return {"review_report": data}

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
        # Fallbacks para manter o contrato com o frontend
        title = str(data.get("title") or spec.get("title") or spec.get("name") or "Aplicação").strip()
        description = str(data.get("description") or spec.get("description") or "").strip()
        files = data.get("files")
        if not isinstance(files, list) or not files:
            files = state.get("code_files") or []
        # Sanitiza files
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
        deploy = data.get("deploy_instructions")
        if isinstance(deploy, str) and deploy.strip():
            artifact["deploy_instructions"] = deploy
        return {"artifact": artifact}

    g = StateGraph(BuilderState)
    g.add_node("techlead", node_techlead)
    g.add_node("engineer", node_engineer)
    g.add_node("developer", node_developer)
    g.add_node("tester", node_tester)
    g.add_node("analyzer", node_analyzer)
    g.add_node("integrator", node_integrator)
    g.add_edge(START, "techlead")
    g.add_edge("techlead", "engineer")
    g.add_edge("engineer", "developer")
    g.add_edge("developer", "tester")
    g.add_edge("tester", "analyzer")
    g.add_edge("analyzer", "integrator")
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


async def run_builder(
    settings: Settings,
    user_request: str,
    model_provider: str | None = None,
) -> dict[str, Any]:
    """Executa o sub-grafo e devolve o `artifact` final (pronto para `metadata.builder`)."""
    graph = get_compiled_builder_graph(settings)
    out = await graph.ainvoke(
        {
            "user_request": user_request or "",
            "model_provider": model_provider,
        },
    )
    artifact = out.get("artifact") if isinstance(out, dict) else None
    if not isinstance(artifact, dict):
        return {
            "title": "Aplicação",
            "description": "Não foi possível gerar a aplicação.",
            "project_type": "frontend_only",
            "framework": "",
            "entry_file": "",
            "files": [],
            "preview_html": "",
            "review_summary": {"tests_ok": False, "issues_fixed": 0, "remaining_warnings": []},
        }
    return artifact
