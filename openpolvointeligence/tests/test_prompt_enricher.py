from openpolvointeligence.graphs.dev_workflow.dev_workflow_prompt_enricher_logic import (
    normalize_enriched_prompt,
    should_enrich,
)


def test_should_enrich_new_project():
    state = {"project_file_tree": [], "file_manifest": [], "compile_attempt": 0}
    assert should_enrich(state, "crie uma landing page") is True


def test_should_enrich_short_prompt_existing_project():
    state = {
        "project_file_tree": ["src/App.tsx"],
        "file_manifest": [{"path": "src/App.tsx", "sha256": "0" * 16, "size": 1, "lang": "tsx"}],
        "compile_attempt": 0,
    }
    assert should_enrich(state, "melhora isso") is True


def test_should_not_enrich_on_retry():
    state = {"project_file_tree": ["src/App.tsx"], "compile_attempt": 1}
    assert should_enrich(state, "crie uma landing page") is False


def test_normalize_enriched_prompt_fallbacks_and_limits():
    raw = "crie um site para uma loja de doces"
    d = {
        "objective": "  " + ("x" * 1000),
        "audience": "y" * 500,
        "sections": ["Hero", "Features", "Hero", "", None, "FAQ", "Footer"],
        "tone": "",
        "palette_hint": "invalid",
        "layout_shell": "invalid",
        "full_prompt": "",
    }
    out = normalize_enriched_prompt(d, raw=raw)
    assert out["objective"].startswith("x")
    assert len(out["objective"]) <= 240
    assert len(out["audience"]) <= 200
    assert out["tone"]
    assert out["palette_hint"] in ("zinc", "slate", "neutral", "stone")
    assert out["layout_shell"] in ("marketing", "dashboard")
    assert out["full_prompt"]
    assert len(out["full_prompt"]) <= 4000
    assert out["sections"] == ["Hero", "Features", "FAQ", "Footer"]
