from __future__ import annotations

from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from openpolvointeligence.core.config import Settings
from openpolvointeligence.core.ollama_health import is_ollama_usable

ModelProvider = Literal["openai", "google", "anthropic", "ollama"]


def cloud_fallback_provider(settings: Settings) -> ModelProvider | None:
    if (settings.openai_api_key or "").strip():
        return "openai"
    if (settings.google_api_key or "").strip():
        return "google"
    if (settings.anthropic_api_key or "").strip():
        return "anthropic"
    return None


def _fallback_if_ollama_unusable(settings: Settings, provider: ModelProvider) -> ModelProvider:
    """Se Ollama não estiver configurado/acessível, usa GPT/Gemini quando houver chave."""
    if provider != "ollama":
        return provider
    if is_ollama_usable(
        settings.ollama_base_url,
        settings.ollama_model,
        enabled=settings.ollama_enabled,
    ):
        return "ollama"
    cloud = cloud_fallback_provider(settings)
    return cloud if cloud else "ollama"


def effective_provider(p: str | None) -> ModelProvider:
    raw = str(p or "").strip().lower()
    if raw in ("", "openai"):
        return "openai"
    if raw == "google":
        return "google"
    if raw == "ollama":
        return "ollama"
    return "openai"


def resolve_chat_provider(settings: Settings, provider: str | None) -> ModelProvider:
    """Resolve provider com fallback resiliente para evitar falhas por chave ausente."""
    raw = str(provider or "").strip().lower()
    has_openai = bool((settings.openai_api_key or "").strip())
    has_google = bool((settings.google_api_key or "").strip())
    has_anthropic = bool((settings.anthropic_api_key or "").strip())

    if raw in ("", "auto"):
        if has_openai:
            return "openai"
        if has_google:
            return "google"
        if has_anthropic:
            return "anthropic"
        return _fallback_if_ollama_unusable(settings, "ollama")

    if raw == "openai":
        if has_openai:
            return "openai"
        if has_google:
            return "google"
        if has_anthropic:
            return "anthropic"
        return _fallback_if_ollama_unusable(settings, "ollama")

    if raw == "google":
        if has_google:
            return "google"
        if has_openai:
            return "openai"
        if has_anthropic:
            return "anthropic"
        return _fallback_if_ollama_unusable(settings, "ollama")

    if raw == "anthropic":
        if has_anthropic:
            return "anthropic"
        if has_openai:
            return "openai"
        if has_google:
            return "google"
        return _fallback_if_ollama_unusable(settings, "ollama")

    if raw == "ollama":
        return _fallback_if_ollama_unusable(settings, "ollama")

    # Valor inesperado: escolhe automaticamente o melhor disponível.
    if has_openai:
        return "openai"
    if has_google:
        return "google"
    return _fallback_if_ollama_unusable(settings, "ollama")


def desk_effective_provider(p: str | None, settings: Settings) -> str:
    """Provider para pedidos Desk — default Ollama; cloud só com flag."""
    raw = str(p or "").strip().lower()
    if not raw or raw == "auto":
        default = str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"
        if default == "ollama":
            cloud = cloud_fallback_provider(settings)
            if cloud and not is_ollama_usable(
                settings.ollama_base_url,
                settings.ollama_model,
                enabled=settings.ollama_enabled,
            ):
                return cloud
        return default
    if raw in ("openai", "google", "anthropic") and not settings.desk_allow_cloud_providers:
        return str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"
    if raw == "anthropic":
        return "openai"  # anthropic opcional futuro — fallback openai se permitido
    if raw == "ollama":
        return "ollama"
    if raw in ("openai", "google"):
        return raw
    return str(settings.desk_default_provider or "ollama").strip().lower() or "ollama"


def resolve_dev_workflow_provider(
    model_provider: str | None,
    settings: Settings,
    desk_context: dict[str, Any] | None = None,
) -> ModelProvider:
    """Provider do dev workflow — mesma resolução resiliente do Desk (Ollama/auto/cloud)."""
    return resolve_desk_reply_provider(model_provider, desk_context, settings)  # type: ignore[return-value]


def resolve_desk_reply_provider(
    model_provider: str | None,
    desk_context: dict[str, Any] | None,
    settings: Settings,
) -> str:
    """Provider do grafo Desk após Go resolver perfis/chaves no body."""
    mp = str(model_provider or "").strip().lower()
    if mp == "ollama":
        return _fallback_if_ollama_unusable(settings, "ollama")
    if mp == "openai" and settings.openai_api_key:
        return "openai"
    if mp == "google" and settings.google_api_key:
        return "google"
    if mp in ("", "auto"):
        if settings.openai_api_key and not settings.google_api_key:
            return "openai"
        if settings.google_api_key and not settings.openai_api_key:
            return "google"
        if settings.openai_api_key:
            return "openai"
        if settings.google_api_key:
            return "google"
        dc_mp = ""
        if isinstance(desk_context, dict):
            dc_mp = str(desk_context.get("model_provider") or "").strip().lower()
        if dc_mp == "ollama":
            return _fallback_if_ollama_unusable(settings, "ollama")
        resolved = desk_effective_provider(dc_mp or "auto", settings)
        if resolved == "ollama":
            return _fallback_if_ollama_unusable(settings, "ollama")
        return resolved
    resolved = desk_effective_provider(model_provider, settings)
    if resolved == "ollama":
        return _fallback_if_ollama_unusable(settings, "ollama")
    return resolved


def supports_native_tools(settings: Settings, provider: str | None) -> bool:
    """True → o provider resolvido suporta tool-calling nativo com fiabilidade.

    OpenAI e Gemini suportam sempre. Ollama depende do modelo, por isso fica atrás
    de flags (``dev_workflow_native_tools`` master + ``dev_workflow_ollama_native_tools``)
    e cai no fallback modo-JSON por omissão — garantindo que o uso local nunca quebra.
    """
    if not bool(getattr(settings, "dev_workflow_native_tools", True)):
        return False
    ep = _fallback_if_ollama_unusable(settings, resolve_chat_provider(settings, provider))
    if ep in ("openai", "google", "anthropic"):
        return True
    if ep == "ollama":
        return bool(getattr(settings, "dev_workflow_ollama_native_tools", False))
    return False


def get_chat_model(
    settings: Settings,
    provider: str | None,
    *,
    json_mode: bool = False,
    max_tokens: int | None = None,
) -> BaseChatModel:
    """Devolve o modelo de chat para o fornecedor; falha se faltar API key."""
    ep = _fallback_if_ollama_unusable(settings, resolve_chat_provider(settings, provider))
    timeout = settings.agent_llm_timeout_s
    if ep == "ollama":
        from langchain_ollama import ChatOllama  # import tardio: opcional em cloud-only

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
    if ep == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("anthropic: no API key configured")
        from langchain_anthropic import ChatAnthropic  # import tardio: opcional

        # Anthropic exige max_tokens; usa um default generoso para codegen.
        kw_anthropic: dict[str, Any] = {
            "model": settings.anthropic_model,
            "api_key": settings.anthropic_api_key,
            "timeout": timeout,
            "max_retries": 1,
            "temperature": 0.1,
            "max_tokens": max_tokens if max_tokens and max_tokens > 0 else 4096,
        }
        return ChatAnthropic(**kw_anthropic)
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
