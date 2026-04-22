from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração via ambiente (alinhar com a API Go onde fizer sentido)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    polvo_internal_key: str = Field(default="", validation_alias="POLVO_INTERNAL_KEY")
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(default=None, validation_alias="GOOGLE_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")
    google_model: str = Field(default="gemini-2.0-flash", validation_alias="GOOGLE_MODEL")
    agent_llm_timeout_s: float = Field(default=120.0, validation_alias="AGENT_LLM_TIMEOUT_S")
    # Timeout dedicado para o sub-grafo Builder (cada node pode produzir ficheiros grandes).
    builder_llm_timeout_s: float = Field(default=180.0, validation_alias="BUILDER_LLM_TIMEOUT_S")
    port: int = Field(default=8090, validation_alias="PORT")
    host: str = Field(default="0.0.0.0", validation_alias="HOST")

    @property
    def has_any_llm_key(self) -> bool:
        return bool((self.openai_api_key or "").strip()) or bool((self.google_api_key or "").strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
