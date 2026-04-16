from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MessagePart(BaseModel):
    role: str
    content: str


class ReplyRequest(BaseModel):
    messages: list[MessagePart]
    model_provider: str = Field(default="openai", description="openai | google")
    conversation_id: str | None = None
    smtp_context: dict[str, Any] | None = Field(
        default=None,
        description="Metadados SMTP do utilizador (from API Go); sem passwords.",
    )
    contacts_context: list[dict[str, Any]] | None = Field(
        default=None,
        description="Contactos guardados (id, name, phone, email) para e-mail e destinatários.",
    )


class ReplyResponse(BaseModel):
    assistant_text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowGenerateRequest(BaseModel):
    model_provider: str = "openai"
    prompt: str
    recording_json: str = ""


class WorkflowGenerateResponse(BaseModel):
    raw_llm: str


class LLMTextRequest(BaseModel):
    model_provider: str = "openai"
    system: str
    user: str


class LLMTextResponse(BaseModel):
    text: str


class CapabilitiesResponse(BaseModel):
    openai_configured: bool
    google_configured: bool
