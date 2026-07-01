"""Classificação explícita do tipo de pedido (zero-token)."""

from __future__ import annotations

from typing import Literal

RequestKind = Literal[
    "new_app",
    "feature",
    "bug_fix",
    "refactor",
    "api_design",
    "edit",
    "delete",
    "explain",
    "abort",
]

_VALID_KINDS: tuple[RequestKind, ...] = (
    "new_app",
    "feature",
    "bug_fix",
    "refactor",
    "api_design",
    "edit",
    "delete",
    "explain",
    "abort",
)

_BUG_KEYWORDS = (
    "corrige",
    "corrigir",
    "corrija",
    "correção",
    "correcção",
    "correcao",
    "conserta",
    "consertar",
    "fix",
    "bug",
    "erro",
    "error",
    "exception",
    "stack trace",
    "traceback",
    "não funciona",
    "nao funciona",
    "não está funcionando",
    "nao esta funcionando",
    "parou de funcionar",
    "está quebrado",
    "esta quebrado",
    "quebrou",
    "broken",
    "tela branca",
    "página branca",
    "pagina branca",
    "não carrega",
    "nao carrega",
    "não abre",
    "nao abre",
    "está errado",
    "esta errado",
    "comportamento errado",
    "deveria",
    "não aparece",
    "nao aparece",
    "sumiu",
    "falha",
    "crash",
    "undefined is not",
    "is not defined",
    "cannot read",
)

_FEATURE_KEYWORDS = (
    "adiciona",
    "adicionar",
    "acrescenta",
    "acrescentar",
    "implementa",
    "implementar",
    "nova página",
    "nova pagina",
    "novo ecrã",
    "nova tela",
    "nova rota",
    "novo endpoint",
    "nova funcionalidade",
    "nova feature",
    "novo recurso",
    "também quero",
    "tambem quero",
    "além disso",
    "alem disso",
    "suporte a",
    "suporte para",
    "integra",
    "integrar",
    "integração",
    "passa a ter",
    "quero que tenha",
    "inclui",
    "incluir",
    "cria uma página",
    "cria um componente",
    "cria uma secção",
    "cria uma seção",
    "novo formulário",
    "novo formulario",
    "novo botão para",
    "filtro",
    "pesquisa",
    "autenticação",
    "autenticacao",
    "login",
    "crud",
    "listagem",
    "paginação",
    "paginacao",
)

_NEW_APP_KEYWORDS = (
    "cria uma app",
    "criar uma app",
    "cria um app",
    "cria uma aplicação",
    "cria uma aplicacao",
    "cria um site",
    "criar um site",
    "cria um sistema",
    "criar um sistema",
    "crie um sistema",
    "cria uma landing",
    "cria uma landing page",
    "landing page",
    "landingpage",
    "cria uma página web",
    "cria uma pagina web",
    "criar uma página web",
    "criar uma pagina web",
    "do zero",
    "novo projeto",
    "novo projecto",
    "novo sistema",
    "nova aplicação",
    "nova aplicacao",
    "scaffold",
    "começa um",
    "comeca um",
    "monta um site",
    "monta uma app",
    "site para",
    "app para",
    "dashboard para",
    "sistema para",
    "sistema de",
    "website",
    "fullstack",
    "frontend e backend",
    "front e back",
)

# Frases que indicam app/sistema novo mesmo com workspace aberto (subpasta dedicada).
_STRONG_NEW_APP_PHRASES = (
    "do zero",
    "novo projeto",
    "novo projecto",
    "novo sistema",
    "cria um sistema",
    "criar um sistema",
    "crie um sistema",
    "cria uma app",
    "criar uma app",
    "cria um app",
    "cria um site",
    "criar um site",
    "scaffold",
    "monta um site",
    "monta uma app",
    "landing page",
)

_REFACTOR_KEYWORDS = (
    "refatora",
    "refatorar",
    "refactor",
    "reestrutura",
    "reestruturar",
    "reorganiza",
    "reorganizar",
    "extrai",
    "extrair",
    "modulariza",
    "modularizar",
    "limpa o código",
    "limpa o codigo",
    "clean code",
    "separa responsabilidades",
    "divide em módulos",
    "divide em modulos",
    "migra para",
    "renomeia",
    "renomear",
    "simplifica",
    "simplificar",
    "remove duplicação",
    "remove duplicacao",
    "dry",
    "solid",
)

_API_DESIGN_KEYWORDS = (
    "openapi",
    "open api",
    "swagger",
    "especificação da api",
    "especificacao da api",
    "contrato da api",
    "contrato api",
    "design da api",
    "desenha a api",
    "desenhar a api",
    "modela a api",
    "modelar a api",
    "endpoints rest",
    "rest api",
    "graphql schema",
    "schema graphql",
    "documenta a api",
    "documentar a api",
    "api spec",
    "spec da api",
)

_EDIT_KEYWORDS = (
    "edita",
    "editar",
    "altera",
    "alterar",
    "modifica",
    "modificar",
    "muda",
    "mudar",
    "atualiza",
    "atualizar",
    "troca",
    "trocar",
    "ajusta",
    "ajustar",
    "edit ",
    "modify",
    "change ",
    "update ",
)

_DELETE_KEYWORDS = (
    "deleta",
    "deletar",
    "remove",
    "remover",
    "apaga",
    "apagar",
    "exclui",
    "excluir",
    "elimina",
    "eliminar",
    "delete ",
    "drop ",
)

_EXPLAIN_KEYWORDS = (
    "o que é",
    "o que e ",
    "como funciona",
    "explica",
    "explique",
    "por que",
    "porque",
    "qual a diferença",
    "qual é",
    "sem alterar",
    "não alteres",
    "nao alteres",
    "só me diz",
    "so me diz",
    "apenas explica",
)


def normalize_request_kind(raw: str | None) -> RequestKind | None:
    if not raw:
        return None
    s = str(raw).strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "new_app": "new_app",
        "newapp": "new_app",
        "scaffold": "new_app",
        "create": "new_app",
        "create_project": "new_app",
        "feature": "feature",
        "new_feature": "feature",
        "enhancement": "feature",
        "modify": "feature",
        "bug_fix": "bug_fix",
        "bugfix": "bug_fix",
        "bug": "bug_fix",
        "fix": "bug_fix",
        "repair": "bug_fix",
        "debug": "bug_fix",
        "refactor": "refactor",
        "refactoring": "refactor",
        "api_design": "api_design",
        "api": "api_design",
        "openapi": "api_design",
        "explain": "explain",
        "question": "explain",
        "edit": "edit",
        "delete": "delete",
        "abort": "abort",
        "reject": "abort",
    }
    mapped = aliases.get(s)
    return mapped  # type: ignore[return-value]


def _count_hits(prompt: str, keywords: tuple[str, ...]) -> int:
    return sum(1 for k in keywords if k in prompt)


def _has_strong_new_app_intent(prompt: str) -> bool:
    return any(phrase in prompt for phrase in _STRONG_NEW_APP_PHRASES)


def classify_request_kind(
    user_prompt: str,
    *,
    has_project: bool,
    has_build_errors: bool = False,
    llm_hint: str | None = None,
) -> RequestKind:
    """Classificação determinística com prioridade sobre o hint do LLM em casos claros."""
    p = (user_prompt or "").lower().strip()
    hint = normalize_request_kind(llm_hint)

    if not p:
        return hint or ("new_app" if not has_project else "feature")

    edit_score = _count_hits(p, _EDIT_KEYWORDS)
    delete_score = _count_hits(p, _DELETE_KEYWORDS)
    explain_score = _count_hits(p, _EXPLAIN_KEYWORDS)
    bug_score = _count_hits(p, _BUG_KEYWORDS)
    feature_score = _count_hits(p, _FEATURE_KEYWORDS)
    new_app_score = _count_hits(p, _NEW_APP_KEYWORDS)
    refactor_score = _count_hits(p, _REFACTOR_KEYWORDS)
    api_design_score = _count_hits(p, _API_DESIGN_KEYWORDS)

    if explain_score and not (
        bug_score
        or feature_score
        or new_app_score
        or refactor_score
        or api_design_score
        or edit_score
        or delete_score
    ):
        if hint in ("abort",):
            return "abort"
        return "explain"

    if not has_project:
        if hint in ("explain", "abort"):
            return hint
        if api_design_score and not new_app_score:
            return "api_design"
        return "new_app"

    if has_build_errors:
        return "bug_fix"

    if delete_score and not feature_score and delete_score >= edit_score:
        return "delete"

    if edit_score and not delete_score:
        return "edit"

    if api_design_score and not bug_score and api_design_score >= feature_score:
        return "api_design"

    if refactor_score and not bug_score and refactor_score >= feature_score:
        return "refactor"

    # Workspace aberto: pedidos de sistema/app novo → new_app (pasta própria), não feature.
    if _has_strong_new_app_intent(p) or (new_app_score > feature_score and new_app_score > 0):
        return "new_app"

    if bug_score and not feature_score:
        return "bug_fix"
    if feature_score and not bug_score:
        return "feature"
    if bug_score and feature_score:
        if hint in ("bug_fix", "feature", "refactor", "api_design"):
            return hint
        return "bug_fix" if bug_score >= feature_score else "feature"

    if hint in (
        "new_app",
        "bug_fix",
        "feature",
        "refactor",
        "api_design",
        "edit",
        "delete",
        "explain",
        "abort",
    ):
        return hint
    if new_app_score and feature_score == 0:
        return "new_app"
    return "feature"


_TRIVIAL_FIX_HINTS = (
    "cor ",
    "cor do",
    "cor da",
    "texto",
    "label",
    "título",
    "titulo",
    "botão",
    "botao",
    "import ",
    "linha ",
    "typo",
    "espaçamento",
    "espacamento",
    "margem",
    "padding",
    "só ",
    "so ",
    "apenas ",
    "pontual",
)


def route_for_request_kind(
    kind: RequestKind,
    *,
    user_prompt: str = "",
    has_project: bool = False,
) -> str:
    """Mapeia o tipo de pedido para a rota do grafo (architect/patch/explain/abort)."""
    if kind == "abort":
        return "abort"
    if kind == "explain":
        return "explain"
    if kind == "edit":
        return "patch"
    if kind == "delete":
        return "architect"
    if kind == "api_design":
        return "architect"
    if kind == "refactor":
        return "architect"
    if kind == "new_app":
        return "architect"
    if kind == "feature":
        return "architect"
    if kind == "bug_fix":
        p = (user_prompt or "").lower()
        if any(h in p for h in _TRIVIAL_FIX_HINTS):
            return "patch"
        return "architect"
    return "architect"


def create_project_for_kind(kind: RequestKind, *, has_workspace: bool) -> bool:
    if kind == "new_app":
        return True
    return False if has_workspace else (kind == "new_app")


def prefers_diff_mode(kind: RequestKind) -> bool:
    return kind in ("bug_fix", "feature", "refactor", "edit")
