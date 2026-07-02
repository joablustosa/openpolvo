"""Resiliência LLM do dev workflow — fallback de provider e erros legíveis."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.core.ollama_health import is_ollama_usable
from openpolvointeligence.graphs.models import ModelProvider, get_chat_model, resolve_chat_provider

_QUOTA_MARKERS = (
    "429",
    "insufficient_quota",
    "exceeded your current quota",
    "rate limit",
    "rate_limit",
    "billing",
    "quota",
)

_AUTH_MARKERS = (
    "incorrect api key",
    "invalid_api_key",
    "invalid api key",
    "unauthorized",
    "error code: 401",
    "permission_denied",
)

_CONN_MARKERS = (
    "connection refused",
    "connect call failed",
    "max retries",
    "timed out",
    "timeout",
    "actively refused",
)


def is_llm_retriable_error(exc: Exception) -> bool:
    raw = str(exc).lower()
    return any(m in raw for m in _QUOTA_MARKERS + _AUTH_MARKERS + _CONN_MARKERS)


def is_llm_quota_error(exc: Exception) -> bool:
    raw = str(exc).lower()
    return any(m in raw for m in _QUOTA_MARKERS)


def _provider_has_key(settings: Settings, provider: str) -> bool:
    if provider == "openai":
        return bool((settings.openai_api_key or "").strip())
    if provider == "google":
        return bool((settings.google_api_key or "").strip())
    if provider == "anthropic":
        return bool((settings.anthropic_api_key or "").strip())
    if provider == "ollama":
        return is_ollama_usable(
            settings.ollama_base_url,
            settings.ollama_model,
            enabled=settings.ollama_enabled,
        )
    return False


def build_provider_fallback_chain(
    settings: Settings,
    primary: str | None,
) -> list[ModelProvider]:
    """Ordem de providers a tentar quando o primário falha (quota, auth, rede)."""
    first = resolve_chat_provider(settings, primary)
    chain: list[ModelProvider] = []

    def add(provider: ModelProvider) -> None:
        if provider not in chain and _provider_has_key(settings, provider):
            chain.append(provider)

    add(first)
    add("ollama")
    add("google")
    add("openai")
    add("anthropic")
    return chain


async def ainvoke_chat(
    settings: Settings,
    provider: str | None,
    messages: list[BaseMessage],
    *,
    json_mode: bool = False,
    max_tokens: int | None = None,
) -> tuple[Any, ModelProvider]:
    """Invoca chat com fallback automático entre providers disponíveis."""
    chain = build_provider_fallback_chain(settings, provider)
    if not chain:
        raise RuntimeError("Nenhum modelo de linguagem disponível (configure Ollama ou chave cloud).")
    last_exc: Exception | None = None
    for p in chain:
        try:
            chat = get_chat_model(
                settings,
                p,
                json_mode=json_mode,
                max_tokens=max_tokens,
            )
            resp = await chat.ainvoke(messages)
            return resp, p
        except Exception as exc:  # noqa: BLE001 — tenta o próximo provider
            last_exc = exc
            if not is_llm_retriable_error(exc):
                raise
    assert last_exc is not None
    raise last_exc


def format_dev_workflow_llm_error(
    detail: str,
    provider: str | None,
    settings: Settings,
) -> str:
    """Mensagem curta e accionável em vez do JSON bruto da API."""
    raw = detail.lower()
    prov = str(provider or "openai").strip().lower()

    if is_llm_quota_error(Exception(detail)):
        ollama_ok = _provider_has_key(settings, "ollama")
        hint = (
            " Use **Ollama (local)** no seletor de modelos"
            if ollama_ok
            else " Configure **Ollama** (`ollama serve`) ou outro perfil com cota em Definições → Modelos LLM"
        )
        return (
            f"A cota do fornecedor **{prov}** esgotou (erro 429).{hint}."
        )

    if any(m in raw for m in _AUTH_MARKERS):
        return (
            f"A chave do fornecedor **{prov}** foi rejeitada. "
            "Verifique o perfil em Definições → Modelos LLM."
        )

    if prov == "ollama" and any(m in raw for m in _CONN_MARKERS):
        base = (settings.ollama_base_url or "http://127.0.0.1:11434").rstrip("/")
        return (
            f"O **Ollama** não responde em `{base}`. "
            f"Execute `ollama serve` e `ollama pull {settings.ollama_model}`."
        )

    if len(detail) > 220:
        return detail[:220] + "…"
    return detail
