"""Testes do build sandbox — parser de erros (puro) e degradação graciosa."""

from __future__ import annotations

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.dev_workflow.dev_workflow_build_sandbox import (
    build_disabled_result,
    build_errors_to_digest,
    node_toolchain_available,
    parse_build_errors,
    run_build_sandbox,
)


def test_parse_tsc_paren_format():
    out = "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'."
    errors = parse_build_errors(out)
    assert len(errors) == 1
    assert errors[0]["file"] == "src/App.tsx"
    assert errors[0]["line"] == 12
    assert "not assignable" in errors[0]["message"]


def test_parse_tsc_colon_format():
    out = "src/pages/Home.tsx:7:3 - error TS2304: Cannot find name 'foo'."
    errors = parse_build_errors(out)
    assert len(errors) == 1
    assert errors[0]["file"] == "src/pages/Home.tsx"
    assert errors[0]["line"] == 7
    assert "Cannot find name" in errors[0]["message"]


def test_parse_multiple_and_dedupe():
    out = "\n".join(
        [
            "src/a.tsx(1,1): error TS1005: ';' expected.",
            "src/a.tsx(1,1): error TS1005: ';' expected.",
            "src/b.tsx(9,2): error TS2552: Cannot find 'bar'.",
            "info: build finished",
        ],
    )
    errors = parse_build_errors(out)
    assert len(errors) == 2
    files = {e["file"] for e in errors}
    assert files == {"src/a.tsx", "src/b.tsx"}


def test_parse_empty_returns_empty():
    assert parse_build_errors("") == []
    assert parse_build_errors("tudo ok, sem erros") == []


def test_build_disabled_result_shape():
    res = build_disabled_result("tsc")
    assert res == {"ok": True, "ran": False, "tool": "tsc", "errors": []}


def test_node_toolchain_available_returns_bool():
    assert isinstance(node_toolchain_available("npm"), bool)


def test_build_errors_to_digest_maps_fields():
    digest = build_errors_to_digest(
        [{"file": "src/App.tsx", "line": 3, "message": "boom"}],
    )
    assert digest[0]["path"] == "src/App.tsx"
    assert digest[0]["line"] == 3
    assert digest[0]["code"] == "build"
    assert digest[0]["message"] == "boom"


async def test_run_build_sandbox_disabled_degrades_gracefully():
    settings = Settings(dev_workflow_build_sandbox_enabled=False, openai_api_key=None)
    result = await run_build_sandbox(settings, {"src/App.tsx": "export default 1;"})
    assert result["ran"] is False
    assert result["ok"] is True


async def test_run_build_sandbox_default_enabled_without_node_degrades():
    settings = Settings(openai_api_key=None)
    # Sem package.json completo ou node — deve degradar ou falhar graciosamente.
    result = await run_build_sandbox(settings, {"src/App.tsx": "export default 1;"})
    assert result["ok"] is True or result.get("ran") is False


async def test_run_build_sandbox_empty_files_degrades():
    settings = Settings(dev_workflow_build_sandbox_enabled=True, openai_api_key=None)
    result = await run_build_sandbox(settings, {})
    assert result["ran"] is False
    assert result["ok"] is True
