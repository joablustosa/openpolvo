"""Testes models Ollama (M1 MODEL-1/2)."""

from unittest.mock import patch

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import (
    desk_effective_provider,
    effective_provider,
    resolve_desk_reply_provider,
)


def test_effective_provider_ollama():
    assert effective_provider("ollama") == "ollama"


def test_desk_effective_provider_default_ollama():
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    with patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=True):
        assert desk_effective_provider(None, s) == "ollama"
        assert desk_effective_provider("auto", s) == "ollama"


def test_desk_effective_provider_blocks_cloud():
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    assert desk_effective_provider("openai", s) == "ollama"


def test_resolve_desk_reply_provider_uses_profile_keys():
    base = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    s = base.model_copy(update={"openai_api_key": "sk-test", "openai_model": "gpt-4.1-mini"})
    assert resolve_desk_reply_provider("openai", {"mode": "agent"}, s) == "openai"


@patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=False)
def test_resolve_desk_reply_provider_auto_falls_back_to_openai(_mock: object) -> None:
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False, openai_api_key="sk-test")
    assert resolve_desk_reply_provider("auto", {"mode": "agent"}, s) == "openai"


@patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=True)
def test_resolve_desk_reply_provider_auto_prefers_ollama_when_usable(_mock: object) -> None:
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False, openai_api_key="sk-test")
    assert resolve_desk_reply_provider("auto", {"mode": "agent"}, s) == "ollama"


def test_resolve_desk_reply_provider_ollama_without_keys():
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    with patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=True):
        assert resolve_desk_reply_provider("ollama", {"mode": "agent"}, s) == "ollama"
        assert resolve_desk_reply_provider("auto", {"model_provider": "ollama"}, s) == "ollama"
