"""Testes de classificação explícita do tipo de pedido (new_app / feature / bug_fix)."""

from openpolvointeligence.graphs.dev_workflow.dev_workflow_request_kind import (
    classify_request_kind,
    create_project_for_kind,
    normalize_request_kind,
    prefers_diff_mode,
    route_for_request_kind,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_router_logic import parse_router_response


def test_no_project_create_keywords_is_new_app():
    kind = classify_request_kind(
        "cria uma landing page para uma cafeteria",
        has_project=False,
    )
    assert kind == "new_app"


def test_no_project_web_page_keywords_is_new_app():
    kind = classify_request_kind(
        "cria uma página web fullstack para uma imobiliária",
        has_project=False,
    )
    assert kind == "new_app"


def test_existing_project_bug_keywords_is_bug_fix():
    kind = classify_request_kind(
        "corrige o erro, o botão não funciona e dá tela branca",
        has_project=True,
    )
    assert kind == "bug_fix"


def test_existing_project_feature_keywords_is_feature():
    kind = classify_request_kind(
        "adiciona uma nova página de contactos com formulário",
        has_project=True,
    )
    assert kind == "feature"


def test_build_errors_force_bug_fix():
    kind = classify_request_kind(
        "muda a cor do título",  # parece feature, mas há erro de build
        has_project=True,
        has_build_errors=True,
    )
    assert kind == "bug_fix"


def test_new_page_in_existing_project_is_feature_not_new_app():
    kind = classify_request_kind(
        "cria uma nova página de preços no site",
        has_project=True,
    )
    assert kind == "feature"


def test_new_system_in_open_workspace_is_new_app_not_feature():
    kind = classify_request_kind(
        "cria um sistema de controle de peças com crud do zero",
        has_project=True,
    )
    assert kind == "new_app"


def test_pure_question_is_explain():
    kind = classify_request_kind(
        "o que é que este componente faz?",
        has_project=True,
    )
    assert kind == "explain"


def test_llm_hint_breaks_tie_when_bug_and_feature():
    # contém keyword de bug ("corrige") e de feature ("adiciona")
    prompt = "corrige o layout e adiciona um botão novo"
    assert classify_request_kind(prompt, has_project=True, llm_hint="feature") == "feature"
    assert classify_request_kind(prompt, has_project=True, llm_hint="bug_fix") == "bug_fix"


def test_normalize_request_kind_aliases():
    assert normalize_request_kind("bugfix") == "bug_fix"
    assert normalize_request_kind("new-feature") == "feature"
    assert normalize_request_kind("scaffold") == "new_app"
    assert normalize_request_kind("garbage") is None


def test_route_for_request_kind_mapping():
    assert route_for_request_kind("new_app") == "architect"
    assert route_for_request_kind("feature") == "architect"
    # Unificado: bug_fix segue o caminho do architect por defeito.
    assert route_for_request_kind("bug_fix") == "architect"
    assert route_for_request_kind("explain") == "explain"
    assert route_for_request_kind("abort") == "abort"


def test_route_for_broad_bug_is_architect():
    kind_route = route_for_request_kind(
        "bug_fix",
        user_prompt="o app está todo partido, refatora a arquitetura inteira",
    )
    assert kind_route == "architect"


def test_route_for_trivial_bug_keeps_patch_shortcut():
    # Atalho opcional: correcção trivial e pontual continua em patch.
    assert route_for_request_kind("bug_fix", user_prompt="corrige só a cor do botão") == "patch"
    assert route_for_request_kind("bug_fix", user_prompt="ajusta o texto do título") == "patch"


def test_route_for_generic_bug_is_architect():
    # Bug sem pistas triviais → caminho unificado (architect → orchestrator → codegen).
    assert (
        route_for_request_kind(
            "bug_fix",
            user_prompt="o formulário não envia os dados para a API",
        )
        == "architect"
    )


def test_create_project_only_for_new_app():
    assert create_project_for_kind("new_app", has_workspace=False) is True
    assert create_project_for_kind("feature", has_workspace=False) is False
    assert create_project_for_kind("bug_fix", has_workspace=True) is False
    assert create_project_for_kind("new_app", has_workspace=True) is True


def test_prefers_diff_mode():
    assert prefers_diff_mode("bug_fix") is True
    assert prefers_diff_mode("feature") is True
    assert prefers_diff_mode("refactor") is True
    assert prefers_diff_mode("new_app") is False


def test_refactor_keywords():
    kind = classify_request_kind(
        "refatora o módulo de autenticação e separa responsabilidades",
        has_project=True,
    )
    assert kind == "refactor"


def test_api_design_keywords():
    kind = classify_request_kind(
        "desenha a api rest com openapi e documenta os endpoints",
        has_project=True,
    )
    assert kind == "api_design"


def test_route_for_refactor_and_api_design():
    assert route_for_request_kind("refactor") == "architect"
    assert route_for_request_kind("api_design") == "architect"


def test_normalize_refactor_and_api_design_aliases():
    assert normalize_request_kind("refactoring") == "refactor"
    assert normalize_request_kind("openapi") == "api_design"


def test_edit_keywords():
    kind = classify_request_kind(
        "edita o componente Header para usar o novo logo",
        has_project=True,
    )
    assert kind == "edit"


def test_delete_keywords():
    kind = classify_request_kind(
        "remove o componente LegacyFooter e limpa imports",
        has_project=True,
    )
    assert kind == "delete"


def test_route_for_edit_and_delete():
    assert route_for_request_kind("edit") == "patch"
    assert route_for_request_kind("delete") == "architect"


def test_create_project_not_for_delete():
    assert create_project_for_kind("delete", has_workspace=True) is False
    assert create_project_for_kind("edit", has_workspace=True) is False


def test_parse_router_response_emits_request_kind_bug():
    data = {"route": "architect", "affected_layers": "frontend"}
    out = parse_router_response(
        data,
        user_prompt="corrige o erro: undefined is not a function",
        has_project=True,
        has_build_errors=True,
    )
    assert out["request_kind"] == "bug_fix"
    # Unificado: bug_fix não-trivial segue o architect.
    assert out["route"] == "architect"


def test_parse_router_response_bug_trivial_allows_patch():
    data = {"route": "patch", "affected_layers": "frontend"}
    out = parse_router_response(
        data,
        user_prompt="corrige só a cor do botão de enviar",
        has_project=True,
        has_build_errors=True,
    )
    assert out["request_kind"] == "bug_fix"
    # Atalho trivial → patch.
    assert out["route"] == "patch"


def test_parse_router_response_new_app_forces_architect():
    data = {"route": "patch", "affected_layers": "frontend", "request_kind": "new_app"}
    out = parse_router_response(
        data,
        user_prompt="cria um site institucional do zero",
        has_project=False,
    )
    assert out["request_kind"] == "new_app"
    assert out["route"] == "architect"


def test_parse_router_response_feature_allows_llm_patch():
    data = {"route": "patch", "affected_layers": "frontend"}
    out = parse_router_response(
        data,
        user_prompt="adiciona um link no menu para a nova página",
        has_project=True,
    )
    assert out["request_kind"] == "feature"
    # LLM pediu patch e é feature pequena → respeita patch
    assert out["route"] == "patch"
