"""Heurísticas para garantir que pedidos de código usam o dev workflow (não só chat)."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow_router_logic import infer_force_code_route

# Novo projecto / site no Estúdio
_CREATE_PROJECT_KEYWORDS = (
    "cria ",
    "criar ",
    "crie ",
    "gera ",
    "gerar ",
    "gere ",
    "monta ",
    "faz ",
    "faça ",
    "desenvolve ",
    "landing",
    "landing page",
    "landingpage",
    "site ",
    "website",
    " página",
    " pagina",
    "página web",
    "pagina web",
    "app ",
    "aplicação",
    "aplicacao",
    "sistema web",
    "sistema completo",
    "fullstack",
    "frontend",
    "backend",
    "estúdio",
    "estudio",
    "preview",
    "polvo code",
    "scaffold",
    "vite",
    "react",
)

# Open Polvo app bugs (não confundir com erro no site em preview)
_OPENPOLVO_APP_MARKERS = (
    "open polvo",
    "openpolvo",
    "smartagent",
    "a aplicação não abre",
    "app não abre",
    "login falhou",
    "não consigo entrar na app",
)


def _has_active_dev_project(
    *,
    sandbox_project_id: str | None,
    project_files: dict[str, str] | None,
    dev_studio_context: dict | None,
) -> bool:
    if str(sandbox_project_id or "").strip():
        return True
    if project_files and len(project_files) > 0:
        return True
    if isinstance(dev_studio_context, dict):
        if str(dev_studio_context.get("project_id") or "").strip():
            return True
        pf = dev_studio_context.get("project_files")
        if isinstance(pf, dict) and len(pf) > 0:
            return True
    return False


def _looks_like_openpolvo_app_support(user_prompt: str) -> bool:
    p = (user_prompt or "").lower()
    return any(m in p for m in _OPENPOLVO_APP_MARKERS)


def should_use_dev_workflow(
    user_prompt: str,
    *,
    sandbox_project_id: str | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict | None = None,
    preview_console_block: str | None = None,
    compile_log: str | None = None,
) -> bool:
    """
    True → o Zé Polvinho deve usar run_dev_workflow_pipeline (ops no disco),
    não o especialista genérico com passos só no chat.
    """
    p = (user_prompt or "").strip()
    if not p:
        return False

    has_project = _has_active_dev_project(
        sandbox_project_id=sandbox_project_id,
        project_files=project_files,
        dev_studio_context=dev_studio_context,
    )

    if has_project:
        if _looks_like_openpolvo_app_support(p):
            return False
        if infer_force_code_route(p, has_project=True):
            return True
        if preview_console_block and preview_console_block.strip():
            return True
        if compile_log and compile_log.strip():
            return True

    pl = p.lower()
    return any(k in pl for k in _CREATE_PROJECT_KEYWORDS)


def boost_analysis_for_dev_workflow(
    analysis: dict,
    *,
    user_prompt: str,
    sandbox_project_id: str | None = None,
    project_files: dict[str, str] | None = None,
    dev_studio_context: dict | None = None,
    preview_console_block: str | None = None,
    compile_log: str | None = None,
) -> dict:
    """Força intent polvo_code_builder quando heurística indica alteração em código."""
    if not should_use_dev_workflow(
        user_prompt,
        sandbox_project_id=sandbox_project_id,
        project_files=project_files,
        dev_studio_context=dev_studio_context,
        preview_console_block=preview_console_block,
        compile_log=compile_log,
    ):
        return analysis
    conf = float(analysis.get("confidence") or 0)
    return {
        **analysis,
        "intent": "polvo_code_builder",
        "confidence": max(conf, 0.88),
        "reasoning": (
            str(analysis.get("reasoning") or "").strip()
            + " [dev_workflow: projecto/preview activo — aplicar no código]"
        )[:500],
    }
