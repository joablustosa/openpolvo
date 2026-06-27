"""Testes do Style RAG — presets determinísticos por domínio (zero-token)."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.dev_workflow_style_rag import (
    build_style_guide_block,
    design_tokens_from_style_guide,
    detect_style_domain,
    retrieve_style_guide,
)

_VALID_PALETTES = {"zinc", "slate", "neutral"}
_VALID_RADIUS = {"sm", "md", "lg"}
_VALID_ACCENTS = {"blue", "violet", "emerald", "orange", "rose", "cyan"}
_VALID_SHELLS = {"marketing", "dashboard"}


def test_detect_domain_dashboard():
    assert detect_style_domain("cria um dashboard de vendas com gráficos") == "dashboard"


def test_detect_domain_ecommerce():
    assert detect_style_domain("loja online com carrinho e checkout") == "ecommerce"


def test_detect_domain_sistema():
    assert detect_style_domain("um sistema admin com CRUD de clientes") == "sistema"


def test_detect_domain_leadpage():
    assert detect_style_domain("landing de captura de leads com newsletter") == "leadpage"


def test_detect_domain_default_landing():
    assert detect_style_domain("uma página institucional bonita") == "landing"


def test_retrieve_style_guide_shape_and_tokens_valid():
    guide = retrieve_style_guide("cria um dashboard financeiro")
    assert guide["domain"] == "dashboard"
    assert set(guide.keys()) >= {
        "domain",
        "palette",
        "tone",
        "layout_shell",
        "references",
        "design_tokens",
        "tokens",
    }
    dt = guide["design_tokens"]
    assert dt["palette_base"] in _VALID_PALETTES
    assert dt["border_radius"] in _VALID_RADIUS
    assert dt["accent"] in _VALID_ACCENTS
    assert dt["mode"] in ("light", "dark")
    assert dt["layout_shell"] in _VALID_SHELLS
    assert dt["layout_shell"] == "dashboard"
    assert isinstance(guide["references"], list) and guide["references"]


def test_retrieve_style_guide_is_deterministic():
    a = retrieve_style_guide("loja online de tênis")
    b = retrieve_style_guide("loja online de tênis")
    assert a == b
    assert a["domain"] == "ecommerce"


def test_brief_override_layout_shell_and_palette():
    guide = retrieve_style_guide(
        "uma landing simples",
        brief={"layout_shell": "dashboard", "palette_hint": "slate"},
    )
    assert guide["design_tokens"]["layout_shell"] == "dashboard"
    assert guide["design_tokens"]["palette_base"] == "slate"


def test_brief_override_ignores_invalid_values():
    guide = retrieve_style_guide(
        "uma landing simples",
        brief={"layout_shell": "carousel", "palette_hint": "pink"},
    )
    # Valores inválidos não devem corromper os tokens do preset.
    assert guide["design_tokens"]["layout_shell"] in _VALID_SHELLS
    assert guide["design_tokens"]["palette_base"] in _VALID_PALETTES


def test_design_tokens_from_style_guide():
    guide = retrieve_style_guide("cria uma landing de marketing")
    tokens = design_tokens_from_style_guide(guide)
    assert tokens["palette_base"] in _VALID_PALETTES
    assert tokens["layout_shell"] == "marketing"
    assert design_tokens_from_style_guide(None) == {}
    assert design_tokens_from_style_guide({}) == {}


def test_build_style_guide_block_contains_domain_and_tokens():
    guide = retrieve_style_guide("dashboard de métricas")
    block = build_style_guide_block(guide)
    assert "Guia de estilo" in block
    assert "dashboard" in block
    assert "palette_base" in block
    assert build_style_guide_block(None) == ""
    assert build_style_guide_block({}) == ""
