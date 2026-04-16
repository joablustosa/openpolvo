from __future__ import annotations

from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from openpolvointeligence.core.config import Settings

ModelProvider = Literal["openai", "google"]


def effective_provider(p: str | None) -> ModelProvider:
    if not p or str(p).strip().lower() in ("", "openai"):
        return "openai"
    if str(p).strip().lower() == "google":
        return "google"
    return "openai"


def get_chat_model(
    settings: Settings,
    provider: str | None,
    *,
    json_mode: bool = False,
) -> BaseChatModel:
    """Devolve o modelo de chat para o fornecedor; falha se faltar API key."""
    ep = effective_provider(provider)
    timeout = settings.agent_llm_timeout_s
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
        return ChatOpenAI(**kw)
    if not settings.google_api_key:
        raise RuntimeError("google: no API key configured")
    # response_mime_type é parâmetro do modelo LangChain, não de model_kwargs (evita aviso e falhas 502).
    kw_google: dict[str, Any] = {
        "model": settings.google_model,
        "google_api_key": settings.google_api_key,
        "temperature": 0.1,
        "timeout": timeout,
        "max_retries": 1,
    }
    if json_mode:
        kw_google["response_mime_type"] = "application/json"
    return ChatGoogleGenerativeAI(**kw_google)
