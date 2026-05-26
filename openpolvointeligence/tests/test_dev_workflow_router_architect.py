"""Testes Router + Architect (camadas e plano PDF contratos)."""

from openpolvointeligence.graphs.dev_workflow_architect_logic import (
    filter_paths_by_layer,
    match_paths_for_feature,
    normalize_architect_plan,
    normalize_design_tokens,
)
from openpolvointeligence.graphs.dev_workflow_router_logic import (
    infer_affected_layers,
    parse_router_response,
)

PDF_PROMPT = (
    "Adicione um botão de exportar PDF na tela de contratos e crie a rota "
    "no backend para gerar esse arquivo"
)


def test_infer_affected_layers_pdf_contracts_fullstack():
    assert infer_affected_layers(PDF_PROMPT) == "fullstack"


def test_parse_router_response_pdf_example():
    data = {
        "route": "architect",
        "affected_layers": "fullstack",
        "stack_hint": "fullstack-mixed",
        "feature_summary": "Botão PDF + rota backend",
        "confidence": 0.97,
        "reason": "UI e API",
    }
    out = parse_router_response(data, user_prompt=PDF_PROMPT)
    assert out["route"] == "architect"
    assert out["affected_layers"] == "fullstack"
    assert out["stack_hint"] == "fullstack-mixed"


def test_filter_paths_by_layer_frontend_only():
    paths = [
        "src/pages/ContractsPage.tsx",
        "internal/handlers/export.go",
        "package.json",
    ]
    fe = filter_paths_by_layer(paths, "frontend")
    assert "src/pages/ContractsPage.tsx" in fe
    assert "internal/handlers/export.go" not in fe


def test_normalize_architect_plan_pdf_scenario():
    compact = {
        "module_signatures": [
            {"file": "src/pages/ContractsPage.tsx", "exports": ["ContractsPage"]},
        ],
        "routes": ["GET /api/contracts"],
        "stack": "fullstack-mixed",
    }
    manifest = ["src/pages/ContractsPage.tsx", "internal/router/routes.go", "src/App.tsx"]
    llm_plan = {
        "execution_plan": {
            "scope": "fullstack",
            "feature": "Exportação PDF de contratos",
            "steps": [
                {
                    "order": 1,
                    "layer": "backend",
                    "action": "create_route",
                    "files": ["internal/handlers/contracts_export.go", "internal/router/routes.go"],
                },
                {
                    "order": 2,
                    "layer": "frontend",
                    "action": "modify_component",
                    "files": ["src/pages/ContractsPage.tsx"],
                },
            ],
        },
        "files_to_create": ["internal/handlers/contracts_export.go"],
        "files_to_modify": [
            "src/pages/ContractsPage.tsx",
            "internal/router/routes.go",
        ],
        "backend_routes": [
            {
                "method": "GET",
                "path": "/api/contracts/export/pdf",
                "handler": "ExportContractsPDF",
            },
        ],
        "stack": "fullstack-mixed",
    }
    plan = normalize_architect_plan(
        llm_plan,
        affected_layers="fullstack",
        stack_hint="fullstack-mixed",
        user_prompt=PDF_PROMPT,
        manifest_paths=manifest,
        compact_context_map=compact,
    )
    assert "src/pages/ContractsPage.tsx" in plan["files_to_modify"]
    assert "internal/handlers/contracts_export.go" in plan["files_to_create"]
    assert "src/App.tsx" not in plan["targets"]
    assert len(plan["targets"]) <= 5
    assert plan["backend_routes"][0]["path"] == "/api/contracts/export/pdf"


def test_normalize_design_tokens_defaults():
    out = normalize_design_tokens({})
    assert out["palette_base"] == "zinc"
    assert out["accent"] == "blue"
    assert out["layout_shell"] == "marketing"


def test_normalize_design_tokens_clamps_invalid():
    out = normalize_design_tokens(
        {
            "palette_base": "pink",
            "border_radius": "xl",
            "accent": "neon",
            "layout_shell": "sidebar",
        },
    )
    assert out["palette_base"] == "zinc"
    assert out["border_radius"] == "md"
    assert out["accent"] == "blue"
    assert out["layout_shell"] == "marketing"


def test_normalize_architect_plan_includes_design_tokens_frontend():
    plan = normalize_architect_plan(
        {
            "design_tokens": {
                "palette_base": "slate",
                "accent": "violet",
                "layout_shell": "dashboard",
            },
            "execution_plan": {"scope": "frontend", "steps": []},
            "files_to_create": ["src/pages/Home.tsx"],
            "stack": "vite-react",
        },
        affected_layers="frontend",
        stack_hint="vite-react",
        user_prompt="landing page",
        manifest_paths=[],
        compact_context_map={},
    )
    assert plan["design_tokens"]["palette_base"] == "slate"
    assert plan["design_tokens"]["accent"] == "violet"
    assert plan["design_tokens"]["layout_shell"] == "dashboard"


def test_normalize_architect_plan_omits_design_tokens_backend_only():
    plan = normalize_architect_plan(
        {
            "execution_plan": {"scope": "backend", "steps": []},
            "files_to_create": ["internal/handlers/x.go"],
            "stack": "go-api",
        },
        affected_layers="backend",
        stack_hint="go-api",
        user_prompt="api",
        manifest_paths=[],
        compact_context_map={},
    )
    assert "design_tokens" not in plan


def test_match_paths_for_contracts():
    matched = match_paths_for_feature(
        PDF_PROMPT,
        ["src/pages/ContractsPage.tsx", "src/pages/Home.tsx"],
        {},
    )
    assert "src/pages/ContractsPage.tsx" in matched["matched_existing"]
