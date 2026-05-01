from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from openpolvointeligence.api.deps import verify_internal_key
from openpolvointeligence.api.llm_merge import merge_llm_from_mapping
from openpolvointeligence.api.schemas import (
    CapabilitiesResponse,
    LLMTextRequest,
    LLMTextResponse,
    ReplyRequest,
    ReplyResponse,
    SocialGenerateRequest,
    SocialGenerateResponse,
    WorkflowGenerateRequest,
    WorkflowGenerateResponse,
)
from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.social_generator import generate_social_post
from openpolvointeligence.graphs.workflow_llm import generate_graph_json, generate_text
from openpolvointeligence.graphs.zepolvinho_graph import run_reply, run_reply_stream

router = APIRouter(prefix="/v1", tags=["v1"])


@router.post("/reply", response_model=ReplyResponse)
async def post_reply(
    body: ReplyRequest,
    _: None = Depends(verify_internal_key),
) -> ReplyResponse:
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    msgs = [m.model_dump() for m in body.messages]
    try:
        tl_ctx = body.task_lists_context
        if tl_ctx is not None and not isinstance(tl_ctx, list):
            tl_ctx = None
        fin_ctx = body.finance_context
        if fin_ctx is not None and not isinstance(fin_ctx, dict):
            fin_ctx = None
        sc_ctx = body.scheduled_tasks_context
        if sc_ctx is not None and not isinstance(sc_ctx, list):
            sc_ctx = None
        prev_logs = body.preview_console_logs
        if prev_logs is not None and not isinstance(prev_logs, list):
            prev_logs = None
        text, meta = await run_reply(
            eff,
            msgs,
            body.model_provider,
            body.smtp_context,
            body.contacts_context,
            tl_ctx,
            fin_ctx,
            body.meta_context,
            sc_ctx,
            conversation_id=body.conversation_id,
            agent_memory=body.agent_memory,
            sandbox_project_id=body.sandbox_project_id,
            preview_console_logs=prev_logs,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"agent error: {e!s}") from e
    return ReplyResponse(assistant_text=text, metadata=meta)


@router.post("/reply/stream")
async def post_reply_stream(
    body: ReplyRequest,
    _: None = Depends(verify_internal_key),
) -> StreamingResponse:
    """Endpoint SSE para streaming do agente.

    Emite eventos ``data: {json}\\n\\n`` à medida que o grafo avança.
    """
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    msgs = [m.model_dump() for m in body.messages]
    tl_ctx = body.task_lists_context
    if tl_ctx is not None and not isinstance(tl_ctx, list):
        tl_ctx = None
    fin_ctx = body.finance_context
    if fin_ctx is not None and not isinstance(fin_ctx, dict):
        fin_ctx = None
    meta_ctx = body.meta_context
    if meta_ctx is not None and not isinstance(meta_ctx, dict):
        meta_ctx = None
    sc_ctx = body.scheduled_tasks_context
    if sc_ctx is not None and not isinstance(sc_ctx, list):
        sc_ctx = None
    prev_logs = body.preview_console_logs
    if prev_logs is not None and not isinstance(prev_logs, list):
        prev_logs = None

    async def event_gen():
        try:
            async for event in run_reply_stream(
                eff,
                msgs,
                body.model_provider,
                body.smtp_context,
                body.contacts_context,
                tl_ctx,
                fin_ctx,
                meta_ctx,
                sc_ctx,
                conversation_id=body.conversation_id,
                agent_memory=body.agent_memory,
                sandbox_project_id=body.sandbox_project_id,
                preview_console_logs=prev_logs,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)[:400]})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/workflows/generate", response_model=WorkflowGenerateResponse)
async def post_workflow_generate(
    body: WorkflowGenerateRequest,
    _: None = Depends(verify_internal_key),
) -> WorkflowGenerateResponse:
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    try:
        raw = await generate_graph_json(
            eff,
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
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    try:
        text = await generate_text(
            eff,
            body.model_provider,
            body.system,
            body.user,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return LLMTextResponse(text=text)


@router.post("/social/generate-post", response_model=SocialGenerateResponse)
async def post_social_generate(
    body: SocialGenerateRequest,
    _: None = Depends(verify_internal_key),
) -> SocialGenerateResponse:
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    try:
        result = await generate_social_post(
            eff,
            body.sites,
            body.platform,
            body.model_provider,
            body.generate_image,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"social generate error: {e!s}") from e
    return SocialGenerateResponse(**result)


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities(
    _: None = Depends(verify_internal_key),
) -> CapabilitiesResponse:
    s = get_settings()
    return CapabilitiesResponse(
        openai_configured=bool((s.openai_api_key or "").strip()),
        google_configured=bool((s.google_api_key or "").strip()),
    )
