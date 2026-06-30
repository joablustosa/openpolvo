from __future__ import annotations

from unittest.mock import patch

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import (
    desk_effective_provider,
    resolve_chat_provider,
)


def _settings(
    *,
    openai: str | None = None,
    google: str | None = None,
    desk_default: str = "ollama",
) -> Settings:
    payload: dict[str, str] = {"DESK_DEFAULT_PROVIDER": desk_default}
    if openai is not None:
        payload["OPENAI_API_KEY"] = openai
    if google is not None:
        payload["GOOGLE_API_KEY"] = google
    return Settings(**payload)


@patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=False)
def test_resolve_chat_provider_ollama_falls_back_to_openai(_mock: object) -> None:
    assert resolve_chat_provider(_settings(openai="k1"), "ollama") == "openai"


@patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=False)
def test_desk_effective_provider_auto_uses_openai_when_ollama_down(_mock: object) -> None:
    s = _settings(openai="k1", desk_default="ollama")
    assert desk_effective_provider("auto", s) == "openai"


@patch("openpolvointeligence.graphs.models.is_ollama_usable", return_value=True)
def test_desk_effective_provider_keeps_ollama_when_usable(_mock: object) -> None:
    s = _settings(openai="k1", desk_default="ollama")
    assert desk_effective_provider("auto", s) == "ollama"
