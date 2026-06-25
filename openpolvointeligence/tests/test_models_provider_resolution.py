from __future__ import annotations

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import resolve_chat_provider


def _settings(openai: str | None = None, google: str | None = None) -> Settings:
    payload: dict[str, str] = {}
    if openai is not None:
        payload["OPENAI_API_KEY"] = openai
    if google is not None:
        payload["GOOGLE_API_KEY"] = google
    return Settings(**payload)


def test_resolve_chat_provider_auto_prefers_openai_then_google() -> None:
    assert resolve_chat_provider(_settings(openai="k1", google="k2"), "auto") == "openai"
    assert resolve_chat_provider(_settings(openai=None, google="k2"), "auto") == "google"


def test_resolve_chat_provider_auto_falls_back_to_ollama_without_keys() -> None:
    assert resolve_chat_provider(_settings(openai=None, google=None), "auto") == "ollama"


def test_resolve_chat_provider_openai_requested_without_key_falls_back() -> None:
    assert resolve_chat_provider(_settings(openai=None, google="k2"), "openai") == "google"
    assert resolve_chat_provider(_settings(openai=None, google=None), "openai") == "ollama"


def test_resolve_chat_provider_google_requested_without_key_falls_back() -> None:
    assert resolve_chat_provider(_settings(openai="k1", google=None), "google") == "openai"
    assert resolve_chat_provider(_settings(openai=None, google=None), "google") == "ollama"
