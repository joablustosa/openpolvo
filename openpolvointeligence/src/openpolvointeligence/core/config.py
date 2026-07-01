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
        populate_by_name=True,
    )

    polvo_internal_key: str = Field(default="", validation_alias="POLVO_INTERNAL_KEY")
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    google_api_key: str | None = Field(default=None, validation_alias="GOOGLE_API_KEY")
    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", validation_alias="OPENAI_MODEL")
    google_model: str = Field(default="gemini-2.0-flash", validation_alias="GOOGLE_MODEL")
    anthropic_model: str = Field(default="claude-sonnet-5", validation_alias="ANTHROPIC_MODEL")
    agent_llm_timeout_s: float = Field(default=120.0, validation_alias="AGENT_LLM_TIMEOUT_S")
    # SerpAPI — mesmo nome que na API Go (`SERPAPI_*`); activa o sub-grafo multi-etapas de pesquisa web no Zé Polvinho.
    serpapi_api_key: str | None = Field(default=None, validation_alias="SERPAPI_API_KEY")
    serpapi_ddg_kl: str | None = Field(default=None, validation_alias="SERPAPI_DDG_KL")
    serpapi_ddg_safe: int = Field(default=0, validation_alias="SERPAPI_DDG_SAFE")
    # Pesquisa web: aprofundar N URLs dos resultados SerpAPI (fetch + sub-grafo por site).
    web_research_max_deep_urls: int = Field(
        default=4, validation_alias="WEB_RESEARCH_MAX_DEEP_URLS"
    )
    web_fetch_timeout_s: float = Field(default=18.0, validation_alias="WEB_FETCH_TIMEOUT_S")
    web_fetch_max_response_bytes: int = Field(
        default=600_000, validation_alias="WEB_FETCH_MAX_RESPONSE_BYTES"
    )
    web_fetch_max_text_chars: int = Field(
        default=24_000, validation_alias="WEB_FETCH_MAX_TEXT_CHARS"
    )
    # Extração principal do HTML (trafilatura); se falso, usa só regex interna.
    web_fetch_use_trafilatura: bool = Field(
        default=True, validation_alias="WEB_FETCH_USE_TRAFILATURA"
    )
    # Web tools (web_search + web_fetch) expostas ao agente de código. web_search
    # precisa de SERPAPI_API_KEY; web_fetch não precisa de chave.
    web_tools_enabled: bool = Field(default=True, validation_alias="OP_WEB_TOOLS_ENABLED")
    web_search_max_results: int = Field(default=5, validation_alias="WEB_SEARCH_MAX_RESULTS")
    port: int = Field(default=8090, validation_alias="PORT")

    @field_validator("openai_api_key", "google_api_key", "anthropic_api_key", mode="before")
    @classmethod
    def _blank_api_key_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

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
    skills_prompt_budget_chars: int = Field(
        default=6000, validation_alias="OP_SKILLS_PROMPT_BUDGET_CHARS"
    )
    # Code RAG (pgvector + embeddings)
    code_rag_database_url: str = Field(default="", validation_alias="CODE_RAG_DATABASE_URL")
    code_rag_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias="CODE_RAG_EMBEDDING_MODEL",
    )
    code_rag_router_top_k: int = Field(default=8, validation_alias="CODE_RAG_ROUTER_TOP_K")
    code_rag_auto_index: bool = Field(default=True, validation_alias="CODE_RAG_AUTO_INDEX")
    # Dev Workflow Teams — worker+revisor por etapa
    dev_workflow_team_mode: bool = Field(default=True, validation_alias="DEV_WORKFLOW_TEAM_MODE")
    dev_workflow_max_review_rounds: int = Field(
        default=3,
        validation_alias="DEV_WORKFLOW_MAX_REVIEW_ROUNDS",
    )
    # Build sandbox real (tsc/vite) — portão anti-bug. Ligado por defeito; degrada
    # graciosamente quando não há Node/npm ou DEV_WORKFLOW_BUILD_SANDBOX_ENABLED=0.
    dev_workflow_build_sandbox_enabled: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_BUILD_SANDBOX_ENABLED",
    )
    dev_workflow_build_sandbox_tool: str = Field(
        default="tsc",
        validation_alias="DEV_WORKFLOW_BUILD_SANDBOX_TOOL",
    )
    dev_workflow_build_sandbox_package_manager: str = Field(
        default="npm",
        validation_alias="DEV_WORKFLOW_BUILD_SANDBOX_PACKAGE_MANAGER",
    )
    dev_workflow_build_sandbox_install_timeout_s: float = Field(
        default=240.0,
        validation_alias="DEV_WORKFLOW_BUILD_SANDBOX_INSTALL_TIMEOUT_S",
    )
    dev_workflow_build_sandbox_build_timeout_s: float = Field(
        default=120.0,
        validation_alias="DEV_WORKFLOW_BUILD_SANDBOX_BUILD_TIMEOUT_S",
    )
    # RAG de memória de erros (pares erro→fix por conversa/projecto).
    dev_workflow_error_memory_enabled: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_ERROR_MEMORY_ENABLED",
    )
    # Bug-fix team: incluir build no verify do workflow debug (só corre se houver script
    # `build` no package.json — projetos sem build não são penalizados).
    dev_workflow_debug_build_check: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_DEBUG_BUILD_CHECK",
    )
    dev_workflow_legacy_core: bool = Field(
        default=False,
        validation_alias="DEV_WORKFLOW_LEGACY_CORE",
    )
    dev_workflow_agent_loop_enabled: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_AGENT_LOOP_ENABLED",
    )
    dev_workflow_agent_loop_max_iterations: int = Field(
        default=20,
        validation_alias="DEV_WORKFLOW_AGENT_LOOP_MAX_ITERATIONS",
    )
    dev_workflow_native_tools: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_NATIVE_TOOLS",
    )
    dev_workflow_ollama_native_tools: bool = Field(
        default=False,
        validation_alias="DEV_WORKFLOW_OLLAMA_NATIVE_TOOLS",
    )
    dev_workflow_subagents_enabled: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_SUBAGENTS_ENABLED",
    )
    dev_workflow_subagent_max_iterations: int = Field(
        default=12,
        validation_alias="DEV_WORKFLOW_SUBAGENT_MAX_ITERATIONS",
    )
    dev_workflow_stream_preview: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_STREAM_PREVIEW",
    )
    # Streaming token-a-token (evento text_delta) do texto do loop de dev — só no modo
    # nativo e no loop top-level; fallback para ainvoke se o stream falhar.
    dev_workflow_stream_tokens: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_STREAM_TOKENS",
    )
    dev_workflow_auto_commit: bool = Field(
        default=True,
        validation_alias="DEV_WORKFLOW_AUTO_COMMIT",
    )
    dev_workflow_terminal_timeout_s: float = Field(
        default=120.0,
        validation_alias="DEV_WORKFLOW_TERMINAL_TIMEOUT_S",
    )
    dev_workflow_checkpoint_enabled: bool = Field(
        default=False,
        validation_alias="DEV_WORKFLOW_CHECKPOINT_ENABLED",
    )
    dev_workflow_checkpoint_path: str = Field(
        default=".dev_workflow_checkpoints.sqlite",
        validation_alias="DEV_WORKFLOW_CHECKPOINT_PATH",
    )
    # Desk MVP — Ollama local + tools
    ollama_base_url: str = Field(
        default="http://127.0.0.1:11434",
        validation_alias="OLLAMA_BASE_URL",
    )
    ollama_model: str = Field(default="llama3.2", validation_alias="OLLAMA_MODEL")
    ollama_enabled: bool = Field(default=True, validation_alias="OLLAMA_ENABLED")
    desk_default_provider: str = Field(default="ollama", validation_alias="DESK_DEFAULT_PROVIDER")
    desk_allow_cloud_providers: bool = Field(
        default=False,
        validation_alias="DESK_ALLOW_CLOUD_PROVIDERS",
    )
    desk_tools_local: bool = Field(default=False, validation_alias="DESK_TOOLS_LOCAL")
    desk_git_allow_commit: bool = Field(default=False, validation_alias="DESK_GIT_ALLOW_COMMIT")
    # Streaming token-a-token (evento `delta`) da resposta do agente Desk. Fallback
    # automático para invocação normal quando o provider/modelo falha a fazer stream.
    desk_stream_tokens: bool = Field(default=True, validation_alias="DESK_STREAM_TOKENS")
    # VCS tools (git + gh). github_tools_enabled expõe a tool `github`. vcs_allow_write
    # permite ações de escrita no caminho local/headless sem UI de aprovação (default
    # False = escrita bloqueada até aprovação; no fluxo bridge o cliente é quem aprova).
    github_tools_enabled: bool = Field(default=True, validation_alias="OP_GITHUB_TOOLS_ENABLED")
    vcs_allow_write: bool = Field(default=False, validation_alias="VCS_ALLOW_WRITE")

    @property
    def has_any_llm_key(self) -> bool:
        return (
            bool((self.openai_api_key or "").strip())
            or bool((self.google_api_key or "").strip())
            or bool((self.anthropic_api_key or "").strip())
            or bool((self.ollama_base_url or "").strip())
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
