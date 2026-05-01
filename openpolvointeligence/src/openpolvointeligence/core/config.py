from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
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
    # SerpAPI — mesmo nome que na API Go (`SERPAPI_*`); activa o sub-grafo multi-etapas de pesquisa web no Zé Polvinho.
    serpapi_api_key: str | None = Field(default=None, validation_alias="SERPAPI_API_KEY")
    serpapi_ddg_kl: str | None = Field(default=None, validation_alias="SERPAPI_DDG_KL")
    serpapi_ddg_safe: int = Field(default=0, validation_alias="SERPAPI_DDG_SAFE")
    # Pesquisa web: aprofundar N URLs dos resultados SerpAPI (fetch + sub-grafo por site).
    web_research_max_deep_urls: int = Field(default=4, validation_alias="WEB_RESEARCH_MAX_DEEP_URLS")
    web_fetch_timeout_s: float = Field(default=18.0, validation_alias="WEB_FETCH_TIMEOUT_S")
    web_fetch_max_response_bytes: int = Field(default=600_000, validation_alias="WEB_FETCH_MAX_RESPONSE_BYTES")
    web_fetch_max_text_chars: int = Field(default=24_000, validation_alias="WEB_FETCH_MAX_TEXT_CHARS")
    port: int = Field(default=8090, validation_alias="PORT")

    @field_validator("serpapi_ddg_safe", mode="before")
    @classmethod
    def _coerce_serpapi_ddg_safe(cls, v: object) -> int:
        if v is None or (isinstance(v, str) and not v.strip()):
            return 0
        try:
            return int(v)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0
    host: str = Field(default="0.0.0.0", validation_alias="HOST")
    # Raízes para procurar `.cursor/skills/**/SKILL.md` (separador `;` ou `,`). Vazio = auto-detect.
    skills_scan_roots: str = Field(default="", validation_alias="OP_SKILLS_SCAN_ROOTS")
    skills_prompt_budget_chars: int = Field(default=6000, validation_alias="OP_SKILLS_PROMPT_BUDGET_CHARS")

    @property
    def has_any_llm_key(self) -> bool:
        return bool((self.openai_api_key or "").strip()) or bool((self.google_api_key or "").strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
