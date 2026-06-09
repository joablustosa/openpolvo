"""Classificação explícita do tipo de pedido: nova app, feature ou correcção de bug.

Camada determinística (zero-token) que dá ao Router e ao pipeline um sinal claro
para decidir create_project, route e use_diff_mode — em vez das heurísticas
dispersas que existiam antes.
"""

from __future__ import annotations

from typing import Literal

RequestKind = Literal["new_app", "feature", "bug_fix", "explain", "abort"]

_VALID_KINDS: tuple[RequestKind, ...] = ("new_app", "feature", "bug_fix", "explain", "abort")

# Sinais fortes de correcção de bug (projecto existente).
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

# Sinais fortes de nova funcionalidade num projecto existente.
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

# Pedido de nova aplicação/scaffold de raiz.
_NEW_APP_KEYWORDS = (
    "cria uma app",
    "criar uma app",
    "cria um app",
    "cria uma aplicação",
    "cria uma aplicacao",
    "cria um site",
    "criar um site",
    "cria uma landing",
    "landing page",
    "do zero",
    "novo projeto",
    "novo projecto",
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
        "explain": "explain",
        "question": "explain",
        "abort": "abort",
        "reject": "abort",
    }
    mapped = aliases.get(s)
    return mapped  # type: ignore[return-value]


def _count_hits(prompt: str, keywords: tuple[str, ...]) -> int:
    return sum(1 for k in keywords if k in prompt)


def classify_request_kind(
    user_prompt: str,
    *,
    has_project: bool,
    has_build_errors: bool = False,
    llm_hint: str | None = None,
) -> RequestKind:
    """
    Classificação determinística com prioridade sobre o hint do LLM em casos claros.

    Regras (ordem):
    1. Sem projecto activo → `new_app` (não há nada para corrigir/estender),
       salvo se for claramente uma pergunta (`explain`).
    2. Erros de build/preview presentes → `bug_fix` (corrigir o que está partido).
    3. Caso contrário, pesa keywords bug vs feature; desempata pelo hint do LLM.
    """
    p = (user_prompt or "").lower().strip()
    hint = normalize_request_kind(llm_hint)

    if not p:
        return hint or ("new_app" if not has_project else "feature")

    explain_score = _count_hits(p, _EXPLAIN_KEYWORDS)
    bug_score = _count_hits(p, _BUG_KEYWORDS)
    feature_score = _count_hits(p, _FEATURE_KEYWORDS)
    new_app_score = _count_hits(p, _NEW_APP_KEYWORDS)

    # Pergunta pura, sem intenção de mudar código.
    if explain_score and not (bug_score or feature_score or new_app_score):
        if hint in ("abort",):
            return "abort"
        return "explain"

    if not has_project:
        # Sem projecto, qualquer pedido de construção é nova app.
        if hint in ("explain", "abort"):
            return hint
        return "new_app"

    # Projecto activo a partir daqui.
    if has_build_errors:
        return "bug_fix"

    if bug_score and not feature_score:
        return "bug_fix"
    if feature_score and not bug_score:
        return "feature"
    if bug_score and feature_score:
        # Empate: confia no hint do LLM, senão prefere o sinal mais forte.
        if hint in ("bug_fix", "feature"):
            return hint
        return "bug_fix" if bug_score >= feature_score else "feature"

    # Sem keywords claras: hint do LLM, senão feature (mudança incremental segura).
    if hint in ("bug_fix", "feature", "explain", "abort"):
        return hint
    if new_app_score:
        # "cria uma nova página" num projecto existente é feature, não nova app.
        return "feature"
    return "feature"


# Pistas de correcção trivial pontual (atalho opcional bug_fix → patch).
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
    """Mapeia o tipo de pedido para a rota do grafo (architect/patch/explain/abort).

    Caminho unificado: `new_app`, `feature` e `bug_fix` seguem por defeito o
    `architect` (plano → orchestrator → codegen), garantindo um plano mínimo
    também para correcções. Mantém-se um atalho opcional `bug_fix → patch`
    apenas para correcções triviais e pontuais (cor, texto, import, 1 linha).
    """
    if kind == "abort":
        return "abort"
    if kind == "explain":
        return "explain"
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
    """Só cria projecto novo quando é mesmo uma nova app e não há workspace."""
    if kind == "new_app":
        return True
    return False if has_workspace else (kind == "new_app")


def prefers_diff_mode(kind: RequestKind) -> bool:
    """bug_fix e feature pequena beneficiam de diffs; new_app reconstrói tudo."""
    return kind in ("bug_fix", "feature")
