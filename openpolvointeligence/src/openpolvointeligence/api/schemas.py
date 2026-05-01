from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MessagePart(BaseModel):
    role: str
    content: str


class ReplyRequest(BaseModel):
    messages: list[MessagePart]
    model_provider: str = Field(default="openai", description="openai | google")
    openai_api_key: str | None = Field(default=None, description="Override por pedido (API Go / SQLite local)")
    google_api_key: str | None = Field(default=None, description="Override por pedido")
    openai_model: str | None = Field(default=None, description="Override do modelo OpenAI")
    google_model: str | None = Field(default=None, description="Override do modelo Gemini")
    conversation_id: str | None = None
    agent_memory: dict[str, str] | None = Field(
        default=None,
        description="Memória persistente (global + builder) enviada pela API Go.",
    )
    smtp_context: dict[str, Any] | None = Field(
        default=None,
        description="Metadados SMTP do utilizador (from API Go); sem passwords.",
    )
    contacts_context: list[dict[str, Any]] | None = Field(
        default=None,
        description="Contactos guardados (id, name, phone, email) para e-mail e destinatários.",
    )
    task_lists_context: list[dict[str, Any]] | None = Field(
        default=None,
        description="Listas de tarefas persistidas (Open Polvo) com items para o agente.",
    )
    finance_context: dict[str, Any] | None = Field(
        default=None,
        description="Finanças pessoais (categorias, transacções, assinaturas) vindas da API Go.",
    )
    meta_context: dict[str, Any] | None = Field(
        default=None,
        description="Integração Meta (WhatsApp, Facebook, Instagram) — flags de configuração e IDs.",
    )
    scheduled_tasks_context: list[dict[str, Any]] | None = Field(
        default=None,
        description="Tarefas agendadas do utilizador (id, name, task_type, cron_expr, timezone, active).",
    )
    sandbox_project_id: str | None = Field(
        default=None,
        description="ID do projecto sandbox — o agente lê o buffer de logs da consola do Preview no servidor.",
    )
    preview_console_logs: list[dict[str, Any]] | None = Field(
        default=None,
        description="Eventos da consola enviados pelo cliente neste turno (level, message, source?, stack?).",
    )


class ReplyResponse(BaseModel):
    assistant_text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowGenerateRequest(BaseModel):
    model_provider: str = "openai"
    openai_api_key: str | None = None
    google_api_key: str | None = None
    openai_model: str | None = None
    google_model: str | None = None
    prompt: str
    recording_json: str = ""


class WorkflowGenerateResponse(BaseModel):
    raw_llm: str


class LLMTextRequest(BaseModel):
    model_provider: str = "openai"
    openai_api_key: str | None = None
    google_api_key: str | None = None
    openai_model: str | None = None
    google_model: str | None = None
    system: str
    user: str


class LLMTextResponse(BaseModel):
    text: str


class CapabilitiesResponse(BaseModel):
    openai_configured: bool
    google_configured: bool


class SocialGenerateRequest(BaseModel):
    sites: list[str] = Field(default_factory=list, description="URLs de sites de referência")
    platform: str = Field(default="facebook", description="facebook | instagram")
    model_provider: str = Field(default="openai", description="openai | google")
    openai_api_key: str | None = None
    google_api_key: str | None = None
    openai_model: str | None = None
    google_model: str | None = None
    generate_image: bool = Field(default=True, description="Gerar imagem via DALL-E 3")


class SocialGenerateResponse(BaseModel):
    title: str
    description: str
    hashtags: list[str]
    image_url: str = ""
    image_prompt: str = ""
    source_url: str = ""
    source_title: str = ""


# --- Sandbox / File Manager (ficheiros gerados pelo agente) -----------------


class SandboxCreateRequest(BaseModel):
    """Se `project_id` for omitido, gera-se um UUID hex."""

    project_id: str | None = Field(default=None, description="Apenas [a-zA-Z0-9._-], max 64 chars")


class SandboxCreateResponse(BaseModel):
    project_id: str


class SandboxWriteRequest(BaseModel):
    path: str = Field(..., description="Caminho relativo ao root do projecto (POSIX)")
    content: str
    encoding: str = "utf-8"


class SandboxFileEntry(BaseModel):
    size_bytes: int
    updated_at: str


class SandboxManifestResponse(BaseModel):
    version: int = 1
    project_id: str
    created_at: str
    updated_at: str
    files: dict[str, SandboxFileEntry] = Field(default_factory=dict)


class SandboxTreeResponse(BaseModel):
    paths: list[str]
    refreshed_manifest: bool = False


class SandboxReadResponse(BaseModel):
    path: str
    content: str
    encoding: str = "utf-8"


class SandboxDevServerStartRequest(BaseModel):
    port: int = Field(default=5175, ge=1024, le=65535)
    command: str | None = Field(
        default=None,
        description="Comando tokenizado (ex.: npx vite --host 127.0.0.1 --port 5175). Se omitido: npm run dev.",
    )


class SandboxDevServerStartResponse(BaseModel):
    project_id: str
    port: int


class SandboxConsoleEntry(BaseModel):
    level: str = Field(default="log", description="error | warn | log | info | debug")
    message: str
    source: str | None = None
    stack: str | None = None
    ts: float | None = None


class SandboxConsoleIngestRequest(BaseModel):
    entries: list[SandboxConsoleEntry] = Field(default_factory=list)


class SandboxConsoleIngestResponse(BaseModel):
    accepted: int


class SandboxConsolePollResponse(BaseModel):
    project_id: str
    entries: list[dict[str, Any]]
