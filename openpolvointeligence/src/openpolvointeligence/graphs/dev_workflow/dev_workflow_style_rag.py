"""Style RAG — recuperação determinística (zero-token) de presets de estilo.

Destila as regras do skill `frontend-design-system` (tokens semânticos, fonte
Geist, densidade alta, `rounded-xl` em cartões, paleta OKLCH neutra, tema polvo)
em presets profissionais por domínio. Dado o pedido/brief, devolve um
`style_guide` rico e `design_tokens` compatíveis com `normalize_design_tokens`,
para o Architect preencher os tokens e o Code_Generator aplicar no JSX.

Determinístico e testável: nenhum LLM é chamado aqui.
"""

from __future__ import annotations

from typing import Any, Literal

StyleDomain = Literal[
    "leadpage",
    "landing",
    "dashboard",
    "sistema",
    "ecommerce",
]

# Tokens base partilhados (regras visuais do design system OpenPolvo).
_BASE_TOKENS: dict[str, str] = {
    "font": "Geist",
    "card_radius": "rounded-xl",
    "control_radius": "rounded-lg",
    "pill_radius": "rounded-4xl",
    "header_height": "h-11",
    "control_height": "h-8",
    "icon_size": "size-4",
    "surface": "bg-card",
    "muted_surface": "bg-muted/30",
    "border": "border-border",
}

# Presets por domínio. `design_tokens` usa o vocabulário de `normalize_design_tokens`.
_PRESETS: dict[StyleDomain, dict[str, Any]] = {
    "leadpage": {
        "domain": "leadpage",
        "palette": "zinc",
        "tone": "persuasivo e direto, foco em conversão e prova social",
        "layout_shell": "marketing",
        "references": [
            "hero com proposta de valor + CTA único acima da dobra",
            "secção de benefícios em cartões rounded-xl",
            "prova social (logos/depoimentos) e formulário de captura curto",
        ],
        "design_tokens": {
            "palette_base": "zinc",
            "border_radius": "lg",
            "accent": "emerald",
            "mode": "light",
            "layout_shell": "marketing",
        },
        "tokens": {
            **_BASE_TOKENS,
            "density": "média",
            "section_padding": "py-20",
            "container": "max-w-5xl",
        },
    },
    "landing": {
        "domain": "landing",
        "palette": "neutral",
        "tone": "confiante e acolhedor, institucional moderno",
        "layout_shell": "marketing",
        "references": [
            "Navbar enxuta + hero centrado",
            "secções Features/Galeria/Pacotes/Footer decompostas em componentes",
            "tipografia forte (text-4xl/5xl font-semibold tracking-tight)",
        ],
        "design_tokens": {
            "palette_base": "neutral",
            "border_radius": "lg",
            "accent": "violet",
            "mode": "light",
            "layout_shell": "marketing",
        },
        "tokens": {
            **_BASE_TOKENS,
            "density": "média",
            "section_padding": "py-24",
            "container": "max-w-6xl",
        },
    },
    "dashboard": {
        "domain": "dashboard",
        "palette": "zinc",
        "tone": "objetivo e analítico, densidade alta nível ferramenta de produto",
        "layout_shell": "dashboard",
        "references": [
            "AppShell com Sidebar + cabeçalho h-11",
            "cartões de métrica rounded-xl, gráficos com CHART_COLOR_VARS",
            "tabelas densas e filtros compactos (h-8)",
        ],
        "design_tokens": {
            "palette_base": "zinc",
            "border_radius": "md",
            "accent": "blue",
            "mode": "light",
            "layout_shell": "dashboard",
        },
        "tokens": {
            **_BASE_TOKENS,
            "density": "alta",
            "section_padding": "p-4",
            "container": "w-full",
        },
    },
    "sistema": {
        "domain": "sistema",
        "palette": "slate",
        "tone": "profissional e funcional, foco em produtividade e clareza",
        "layout_shell": "dashboard",
        "references": [
            "layout admin com Sidebar de navegação e área de conteúdo rolável",
            "formulários com Input/Label/Select shadcn, ações primárias únicas",
            "estados de vazio e tabelas com paginação compacta",
        ],
        "design_tokens": {
            "palette_base": "slate",
            "border_radius": "md",
            "accent": "blue",
            "mode": "light",
            "layout_shell": "dashboard",
        },
        "tokens": {
            **_BASE_TOKENS,
            "density": "alta",
            "section_padding": "p-4",
            "container": "w-full",
        },
    },
    "ecommerce": {
        "domain": "ecommerce",
        "palette": "neutral",
        "tone": "vibrante e confiável, foco em produto e conversão de compra",
        "layout_shell": "marketing",
        "references": [
            "grelha de produtos em cartões rounded-xl com imagem + preço + CTA",
            "barra de filtros/categorias e carrinho acessível",
            "destaque de ofertas com Badge (accent) sem gradientes",
        ],
        "design_tokens": {
            "palette_base": "neutral",
            "border_radius": "lg",
            "accent": "orange",
            "mode": "light",
            "layout_shell": "marketing",
        },
        "tokens": {
            **_BASE_TOKENS,
            "density": "média",
            "section_padding": "py-16",
            "container": "max-w-6xl",
        },
    },
}

_DEFAULT_DOMAIN: StyleDomain = "landing"

# Sinais determinísticos (PT + EN) por domínio — ordem importa (mais específico primeiro).
_DOMAIN_SIGNALS: tuple[tuple[StyleDomain, tuple[str, ...]], ...] = (
    (
        "ecommerce",
        (
            "ecommerce",
            "e-commerce",
            "loja",
            "carrinho",
            "checkout",
            "produto",
            "produtos",
            "catálogo",
            "catalogo",
            "vender",
            "venda online",
            "marketplace",
            "store",
            "shop",
        ),
    ),
    (
        "dashboard",
        (
            "dashboard",
            "painel",
            "métrica",
            "metrica",
            "métricas",
            "metricas",
            "gráfico",
            "grafico",
            "gráficos",
            "analytics",
            "kpi",
            "relatório",
            "relatorio",
            "indicadores",
        ),
    ),
    (
        "sistema",
        (
            "sistema",
            "admin",
            "administra",
            "painel administrativo",
            "crud",
            "gestão",
            "gestao",
            "backoffice",
            "back office",
            "erp",
            "interno",
            "cadastro",
        ),
    ),
    (
        "leadpage",
        (
            "lead",
            "leads",
            "captura",
            "conversão",
            "conversao",
            "newsletter",
            "inscrição",
            "inscricao",
            "squeeze",
            "lead page",
            "leadpage",
            "formulário de contato",
            "formulario de contato",
        ),
    ),
    (
        "landing",
        (
            "landing",
            "landing page",
            "site",
            "página inicial",
            "pagina inicial",
            "institucional",
            "marketing",
            "portfólio",
            "portfolio",
            "homepage",
            "vitrine",
        ),
    ),
)


def detect_style_domain(user_prompt: str, brief: dict[str, Any] | None = None) -> StyleDomain:
    """Classifica o domínio de estilo a partir do pedido (+ brief opcional)."""
    text = (user_prompt or "").lower()
    if isinstance(brief, dict):
        extra = " ".join(
            str(brief.get(k) or "") for k in ("objective", "audience", "layout_shell", "tone")
        )
        text = f"{text} {extra.lower()}"

    for domain, signals in _DOMAIN_SIGNALS:
        if any(sig in text for sig in signals):
            return domain
    return _DEFAULT_DOMAIN


def _apply_brief_overrides(guide: dict[str, Any], brief: dict[str, Any] | None) -> dict[str, Any]:
    """Refina o preset com pistas do brief (layout_shell, palette_hint), validando."""
    if not isinstance(brief, dict):
        return guide
    tokens = dict(guide["design_tokens"])

    shell = str(brief.get("layout_shell") or "").strip().lower()
    if shell in ("marketing", "dashboard"):
        tokens["layout_shell"] = shell
        guide = {**guide, "layout_shell": shell}

    palette_hint = str(brief.get("palette_hint") or "").strip().lower()
    if palette_hint in ("zinc", "slate", "neutral"):
        tokens["palette_base"] = palette_hint
        guide = {**guide, "palette": palette_hint}

    guide = {**guide, "design_tokens": tokens}
    return guide


def retrieve_style_guide(
    user_prompt: str,
    brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Recupera um `style_guide` profissional para o pedido (determinístico)."""
    domain = detect_style_domain(user_prompt, brief)
    preset = _PRESETS[domain]
    guide: dict[str, Any] = {
        "domain": preset["domain"],
        "palette": preset["palette"],
        "tone": preset["tone"],
        "layout_shell": preset["layout_shell"],
        "references": list(preset["references"]),
        "design_tokens": dict(preset["design_tokens"]),
        "tokens": dict(preset["tokens"]),
    }
    return _apply_brief_overrides(guide, brief)


def design_tokens_from_style_guide(style_guide: dict[str, Any] | None) -> dict[str, str]:
    """Extrai os `design_tokens` (vocabulário do Architect) do style_guide."""
    if not isinstance(style_guide, dict):
        return {}
    tokens = style_guide.get("design_tokens")
    if not isinstance(tokens, dict):
        return {}
    return {str(k): str(v) for k, v in tokens.items()}


def build_style_guide_block(style_guide: dict[str, Any] | None) -> str:
    """Bloco compacto para injectar no human message do codegen/architect."""
    if not isinstance(style_guide, dict) or not style_guide:
        return ""
    refs = style_guide.get("references") or []
    refs_lines = "\n".join(f"- {r}" for r in refs[:6])
    tokens = style_guide.get("tokens") or {}
    dt = style_guide.get("design_tokens") or {}
    token_lines = "\n".join(f"- {k}: {v}" for k, v in tokens.items())
    return (
        "## Guia de estilo (Style RAG — OBRIGATÓRIO)\n"
        f"- Domínio: **{style_guide.get('domain')}**\n"
        f"- Tom: {style_guide.get('tone')}\n"
        f"- Layout shell: {style_guide.get('layout_shell')}\n"
        f"- Paleta base: {style_guide.get('palette')}\n"
        f"### design_tokens\n{_kv_lines(dt)}\n"
        f"### Tokens visuais\n{token_lines}\n"
        f"### Padrões de referência\n{refs_lines}\n"
        "Aplica tokens semânticos (bg-background, text-foreground, border-border), fonte Geist, "
        "cartões rounded-xl, controlos rounded-lg, densidade alta. Proibido cores cruas/gradientes."
    )


def _kv_lines(d: dict[str, Any]) -> str:
    return "\n".join(f"- {k}: {v}" for k, v in d.items())
