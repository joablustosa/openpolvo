from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from openpolvointeligence.api.deps import verify_internal_key
from openpolvointeligence.api.schemas import (
    CapabilitiesResponse,
    LLMTextRequest,
    LLMTextResponse,
    ReplyRequest,
    ReplyResponse,
    WorkflowGenerateRequest,
    WorkflowGenerateResponse,
)
from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.workflow_llm import generate_graph_json, generate_text
from openpolvointeligence.graphs.zepolvinho_graph import run_reply

router = APIRouter(prefix="/v1", tags=["v1"])


@router.post("/reply", response_model=ReplyResponse)
async def post_reply(
    body: ReplyRequest,
    _: None = Depends(verify_internal_key),
) -> ReplyResponse:
    settings = get_settings()
    if not settings.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    msgs = [m.model_dump() for m in body.messages]
    try:
        text, meta = await run_reply(settings, msgs, body.model_provider)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"agent error: {e!s}") from e
    return ReplyResponse(assistant_text=text, metadata=meta)


@router.post("/workflows/generate", response_model=WorkflowGenerateResponse)
async def post_workflow_generate(
    body: WorkflowGenerateRequest,
    _: None = Depends(verify_internal_key),
) -> WorkflowGenerateResponse:
    settings = get_settings()
    if not settings.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    try:
        raw = await generate_graph_json(
            settings,
            body.model_provider,
            body.prompt,
            body.recording_json,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return WorkflowGenerateResponse(raw_llm=raw)


@router.post("/llm/generate-text", response_model=LLMTextResponse)
async def post_llm_generate_text(
    body: LLMTextRequest,
    _: None = Depends(verify_internal_key),
) -> LLMTextResponse:
    settings = get_settings()
    if not settings.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    try:
        text = await generate_text(
            settings,
            body.model_provider,
            body.system,
            body.user,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return LLMTextResponse(text=text)


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities(
    _: None = Depends(verify_internal_key),
) -> CapabilitiesResponse:
    s = get_settings()
    return CapabilitiesResponse(
        openai_configured=bool((s.openai_api_key or "").strip()),
        google_configured=bool((s.google_api_key or "").strip()),
    )
