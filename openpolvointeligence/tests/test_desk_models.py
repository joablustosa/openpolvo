"""Testes models Ollama (M1 MODEL-1/2)."""

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import desk_effective_provider, effective_provider


def test_effective_provider_ollama():
    assert effective_provider("ollama") == "ollama"


def test_desk_effective_provider_default_ollama():
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    assert desk_effective_provider(None, s) == "ollama"
    assert desk_effective_provider("auto", s) == "ollama"


def test_desk_effective_provider_blocks_cloud():
    s = Settings(desk_default_provider="ollama", desk_allow_cloud_providers=False)
    assert desk_effective_provider("openai", s) == "ollama"
