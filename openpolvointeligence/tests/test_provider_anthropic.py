"""Testes do fornecedor Anthropic (Claude) no resolvedor de modelos."""

from __future__ import annotations

import sys
import types

from openpolvointeligence.api.llm_merge import merge_llm_from_mapping
from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs import models as models_mod
from openpolvointeligence.graphs.models import (
    cloud_fallback_provider,
    get_chat_model,
    resolve_chat_provider,
    supports_native_tools,
)


def _with_anthropic() -> Settings:
    return Settings().model_copy(
        update={"anthropic_api_key": "sk-ant-test", "ollama_enabled": False},
    )


def test_resolve_and_native_anthropic() -> None:
    s = _with_anthropic()
    assert resolve_chat_provider(s, "anthropic") == "anthropic"
    assert resolve_chat_provider(s, "auto") == "anthropic"
    assert supports_native_tools(s, "anthropic") is True
    assert cloud_fallback_provider(s) == "anthropic"


def test_merge_maps_anthropic() -> None:
    s = merge_llm_from_mapping(
        Settings(),
        {"anthropic_api_key": "k", "anthropic_model": "claude-opus-4"},
    )
    assert s.anthropic_api_key == "k"
    assert s.anthropic_model == "claude-opus-4"
    assert s.has_any_llm_key is True


def test_get_chat_model_anthropic_uses_chatanthropic(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeChatAnthropic:
        def __init__(self, **kw: object) -> None:
            captured.update(kw)

    fake_mod = types.ModuleType("langchain_anthropic")
    fake_mod.ChatAnthropic = FakeChatAnthropic  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langchain_anthropic", fake_mod)

    s = _with_anthropic().model_copy(update={"anthropic_model": "claude-sonnet-5"})
    model = get_chat_model(s, "anthropic")
    assert isinstance(model, FakeChatAnthropic)
    assert captured["model"] == "claude-sonnet-5"
    assert captured["api_key"] == "sk-ant-test"
    assert captured["max_tokens"] == 4096  # default generoso quando não especificado
    assert models_mod.ModelProvider is not None
