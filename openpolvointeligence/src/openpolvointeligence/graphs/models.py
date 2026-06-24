from __future__ import annotations

from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from openpolvointeligence.core.config import Settings

ModelProvider = Literal["openai", "google", "ollama"]


def effective_provider(p: str | None) -> ModelProvider:
    raw = str(p or "").strip().lower()
    if raw in ("", "openai"):
        return "openai"
    if raw == "google":
        return "google"
    if raw == "ollama":
        return "ollama"
    return "openai"


def desk_effective_provider(p: str | None, settings: Settings) -> str:
    """Provider para pedidos Desk — default Ollama; cloud só com flag."""
    raw = str(p or "").strip().lower()
    if not raw or raw == "auto":
        return str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"
    if raw in ("openai", "google", "anthropic") and not settings.desk_allow_cloud_providers:
        return str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"
    if raw == "anthropic":
        return "openai"  # anthropic opcional futuro — fallback openai se permitido
    if raw == "ollama":
        return "ollama"
    if raw in ("openai", "google"):
        return raw
    return str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"


def get_chat_model(
    settings: Settings,
    provider: str | None,
    *,
    json_mode: bool = False,
    max_tokens: int | None = None,
) -> BaseChatModel:
    """Devolve o modelo de chat para o fornecedor; falha se faltar API key."""
    ep = effective_provider(provider)
    timeout = settings.agent_llm_timeout_s
    if ep == "ollama":
        kw_ollama: dict[str, Any] = {
            "model": settings.ollama_model,
            "base_url": settings.ollama_base_url.rstrip("/"),
            "temperature": 0.1,
            "num_predict": max_tokens if max_tokens and max_tokens > 0 else None,
        }
        return ChatOllama(**{k: v for k, v in kw_ollama.items() if v is not None})
    if ep == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("openai: no API key configured")
        kw: dict[str, Any] = {
            "model": settings.openai_model,
            "api_key": settings.openai_api_key,
            "timeout": timeout,
            "max_retries": 1,
            "temperature": 0.1,
        }
        if json_mode:
            kw["model_kwargs"] = {"response_format": {"type": "json_object"}}
        if max_tokens is not None and max_tokens > 0:
            kw["max_tokens"] = max_tokens
        return ChatOpenAI(**kw)
    if not settings.google_api_key:
        raise RuntimeError("google: no API key configured")
    kw_google: dict[str, Any] = {
        "model": settings.google_model,
        "google_api_key": settings.google_api_key,
        "temperature": 0.1,
        "timeout": timeout,
        "max_retries": 1,
    }
    if json_mode:
        kw_google["response_mime_type"] = "application/json"
    if max_tokens is not None and max_tokens > 0:
        kw_google["max_output_tokens"] = max_tokens
    return ChatGoogleGenerativeAI(**kw_google)
