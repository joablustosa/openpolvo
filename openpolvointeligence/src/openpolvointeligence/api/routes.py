from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from openpolvointeligence.api.deps import verify_internal_key
from openpolvointeligence.api.llm_merge import merge_llm_from_mapping
from openpolvointeligence.api.schemas import (
    CapabilitiesResponse,
    DevStudioSelfHealRequest,
    DevStudioSelfHealResponse,
    CodeRagIndexRequest,
    CodeRagIndexResponse,
    CodeRagQueryRequest,
    CodeRagQueryResponse,
    LLMTextRequest,
    LLMTextResponse,
    ReplyRequest,
    ReplyResponse,
    DeskToolResultRequest,
    SocialGenerateRequest,
    SocialGenerateResponse,
    WorkflowGenerateRequest,
    WorkflowGenerateResponse,
    WorkflowWebSearchEnrichRequest,
    WorkflowWebSearchEnrichResponse,
)
from openpolvointeligence.core.config import get_settings
from openpolvointeligence.graphs.social.social_generator import generate_social_post
from openpolvointeligence.graphs.workflow_builder.workflow_llm import generate_text
from openpolvointeligence.graphs.workflow_builder.workflow_specialist_graph import (
    run_workflow_specialist,
)
from openpolvointeligence.graphs.workflow_builder.workflow_web_search_enrich import (
    run_workflow_web_search_enrich,
)
from openpolvointeligence.graphs.dev_workflow.dev_workflow_self_heal_logic import (
    run_dev_workflow_self_heal,
)
from openpolvointeligence.code_rag.indexer import index_project_files
from openpolvointeligence.code_rag.retriever import build_rag_context_block, retrieve_for_router
from openpolvointeligence.graphs.orchestrator.zepolvinho_graph import (
    run_reply,
    run_reply_stream,
    wants_pdf_study_specialist,
)
from openpolvointeligence.graphs.desk.desk_routing import should_use_desk_graph
from openpolvointeligence.graphs.desk.desk_reply import run_desk_reply, run_desk_reply_stream
from openpolvointeligence.graphs.desk.desk_tool_bridge import get_bridge
from openpolvointeligence.graphs.message_utils import last_user_text
from openpolvointeligence.graphs.pdf_read.pdf_read_graph import (
    run_pdf_read_pipeline,
    run_pdf_read_stream,
)
from openpolvointeligence.graphs.pdf_read.pdf_read_routing import should_use_pdf_read_workflow
from openpolvointeligence.graphs.pdf_study.pdf_study_graph import (
    run_pdf_study_pipeline,
    run_pdf_study_stream,
)
from openpolvointeligence.graphs.xlsx_full.xlsx_full_graph import (
    run_xlsx_full_pipeline,
    run_xlsx_full_stream,
)
from openpolvointeligence.graphs.xlsx_full.xlsx_full_routing import should_use_xlsx_workflow
from openpolvointeligence.graphs.documents_full.documents_full_graph import (
    run_documents_full_pipeline,
    run_documents_full_stream,
)
from openpolvointeligence.graphs.documents_full.documents_full_routing import (
    should_use_documents_workflow,
)
from openpolvointeligence.graphs.conversation.conversation_reply_routing import (
    should_use_conversation_workflow,
)
from openpolvointeligence.graphs.conversation.conversation_reply_graph import (
    run_conversation_reply_pipeline,
    run_conversation_reply_stream,
)
from openpolvointeligence.graphs.dev_workflow.api.routes_dev_agent import (
    router as dev_agent_router,
)

router = APIRouter(prefix="/v1", tags=["v1"])
router.include_router(dev_agent_router)


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
        pft = body.project_file_tree
        if pft is not None and not isinstance(pft, list):
            pft = None
        pf = body.project_files
        if pf is not None and not isinstance(pf, dict):
            pf = None
        dsc = body.dev_studio_context
        if dsc is not None and not isinstance(dsc, dict):
            dsc = None
        desk_ctx = body.desk_context
        if desk_ctx is not None and not isinstance(desk_ctx, dict):
            desk_ctx = None
        smtp_ctx = body.smtp_context
        if smtp_ctx is not None and not isinstance(smtp_ctx, dict):
            smtp_ctx = None
        contacts_ctx = body.contacts_context
        if contacts_ctx is not None and not isinstance(contacts_ctx, list):
            contacts_ctx = None
        attachments = [a.model_dump() for a in body.attachments] if body.attachments else []
        if should_use_pdf_read_workflow(last_user_text(msgs), attachments):
            text, meta = await run_pdf_read_pipeline(
                eff,
                msgs,
                body.model_provider,
                attachments,
                agent_memory=body.agent_memory,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
        if should_use_xlsx_workflow(last_user_text(msgs), attachments):
            text, meta = await run_xlsx_full_pipeline(
                eff,
                msgs,
                body.model_provider,
                attachments,
                agent_memory=body.agent_memory,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
        if should_use_documents_workflow(last_user_text(msgs), attachments):
            text, meta = await run_documents_full_pipeline(
                eff,
                msgs,
                body.model_provider,
                attachments,
                agent_memory=body.agent_memory,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
        if wants_pdf_study_specialist(last_user_text(msgs)):
            text, meta = await run_pdf_study_pipeline(
                eff,
                msgs,
                body.model_provider,
                agent_memory=body.agent_memory,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
        if should_use_conversation_workflow(last_user_text(msgs)):
            text, meta = await run_conversation_reply_pipeline(
                eff,
                msgs,
                body.model_provider,
                agent_memory=body.agent_memory,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
        if should_use_desk_graph(desk_ctx):
            text, meta = await run_desk_reply(
                eff,
                msgs,
                body.model_provider,
                desk_ctx,
                agent_memory=body.agent_memory,
                smtp_context=smtp_ctx,
                contacts_context=contacts_ctx,
            )
            return ReplyResponse(assistant_text=text, metadata=meta)
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
            project_file_tree=pft,
            project_files=pf,
            dev_studio_context=dsc,
            compile_log=body.compile_log,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"agent error: {e!s}") from e
    return ReplyResponse(assistant_text=text, metadata=meta)


@router.post("/dev-studio/self-heal", response_model=DevStudioSelfHealResponse)
async def post_dev_studio_self_heal(
    body: DevStudioSelfHealRequest,
    _: None = Depends(verify_internal_key),
) -> DevStudioSelfHealResponse:
    """Self-Healing: corrige erros de build do WebContainer com patches mínimos."""
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")

    prev_logs = body.preview_console_logs
    if prev_logs is not None and not isinstance(prev_logs, list):
        prev_logs = None
    pf = body.project_files
    if pf is not None and not isinstance(pf, dict):
        pf = None
    dsc = body.dev_studio_context
    if dsc is not None and not isinstance(dsc, dict):
        dsc = None
    plan = dsc.get("plan") if isinstance(dsc, dict) else None

    try:
        text, meta = await run_dev_workflow_self_heal(
            eff,
            body.model_provider,
            user_prompt=str(body.user_prompt or ""),
            compile_log=body.compile_log,
            preview_console_logs=prev_logs,
            project_files=pf,
            plan=plan if isinstance(plan, dict) else None,
            conversation_id=body.conversation_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"self-heal error: {e!s}") from e
    return DevStudioSelfHealResponse(assistant_text=text, metadata=meta)


@router.post("/dev-studio/code-rag/index", response_model=CodeRagIndexResponse)
async def post_code_rag_index(
    body: CodeRagIndexRequest,
    _: None = Depends(verify_internal_key),
) -> CodeRagIndexResponse:
    """Indexa ficheiros do projecto → embeddings → pgvector."""
    settings = get_settings()
    pf = body.project_files
    if not isinstance(pf, dict) or not pf:
        raise HTTPException(status_code=400, detail="project_files required")
    try:
        result = await index_project_files(settings, body.project_id.strip(), pf)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"code-rag index: {e!s}") from e
    return CodeRagIndexResponse(
        project_id=result.project_id,
        files_scanned=result.files_scanned,
        chunks_indexed=result.chunks_indexed,
        embedding_model=result.embedding_model,
        store=result.store,
    )


@router.post("/dev-studio/code-rag/query", response_model=CodeRagQueryResponse)
async def post_code_rag_query(
    body: CodeRagQueryRequest,
    _: None = Depends(verify_internal_key),
) -> CodeRagQueryResponse:
    """Busca semântica (mesma lógica do Router LangGraph)."""
    settings = get_settings()
    try:
        chunks, paths = await retrieve_for_router(
            settings,
            body.project_id.strip(),
            body.prompt,
            top_k=body.top_k,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"code-rag query: {e!s}") from e
    return CodeRagQueryResponse(
        paths=paths,
        context_block=build_rag_context_block(chunks),
        chunks=[
            {
                "path": c.path,
                "chunk_type": c.chunk_type,
                "symbol_name": c.symbol_name,
                "score": c.score,
                "start_line": c.start_line,
                "end_line": c.end_line,
            }
            for c in chunks
        ],
    )


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
    pft = body.project_file_tree
    if pft is not None and not isinstance(pft, list):
        pft = None
    pf = body.project_files
    if pf is not None and not isinstance(pf, dict):
        pf = None
    dsc = body.dev_studio_context
    if dsc is not None and not isinstance(dsc, dict):
        dsc = None
    desk_ctx = body.desk_context
    if desk_ctx is not None and not isinstance(desk_ctx, dict):
        desk_ctx = None
    smtp_ctx = body.smtp_context
    if smtp_ctx is not None and not isinstance(smtp_ctx, dict):
        smtp_ctx = None
    contacts_ctx = body.contacts_context
    if contacts_ctx is not None and not isinstance(contacts_ctx, list):
        contacts_ctx = None
    attachments = [a.model_dump() for a in body.attachments] if body.attachments else []

    async def event_gen():
        try:
            if should_use_pdf_read_workflow(last_user_text(msgs), attachments):
                async for event in run_pdf_read_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    attachments,
                    agent_memory=body.agent_memory,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
            if should_use_xlsx_workflow(last_user_text(msgs), attachments):
                async for event in run_xlsx_full_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    attachments,
                    agent_memory=body.agent_memory,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
            if should_use_documents_workflow(last_user_text(msgs), attachments):
                async for event in run_documents_full_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    attachments,
                    agent_memory=body.agent_memory,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
            if wants_pdf_study_specialist(last_user_text(msgs)):
                async for event in run_pdf_study_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    agent_memory=body.agent_memory,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
            if should_use_conversation_workflow(last_user_text(msgs)):
                async for event in run_conversation_reply_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    agent_memory=body.agent_memory,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
            if should_use_desk_graph(desk_ctx):
                async for event in run_desk_reply_stream(
                    eff,
                    msgs,
                    body.model_provider,
                    desk_ctx,
                    agent_memory=body.agent_memory,
                    smtp_context=smtp_ctx,
                    contacts_context=contacts_ctx,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                return
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
                project_file_tree=pft,
                project_files=pf,
                dev_studio_context=dsc,
                compile_log=body.compile_log,
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
        result = await run_workflow_specialist(
            eff,
            body.model_provider,
            body.prompt,
            body.recording_json,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return WorkflowGenerateResponse(
        raw_llm=result["raw_llm"],
        brief=result["brief"],
        step_blueprint=result["step_blueprint"],
        assistant_text=result["assistant_text"],
    )


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


@router.post("/workflows/web-search-enrich", response_model=WorkflowWebSearchEnrichResponse)
async def post_workflow_web_search_enrich(
    body: WorkflowWebSearchEnrichRequest,
    _: None = Depends(verify_internal_key),
) -> WorkflowWebSearchEnrichResponse:
    """SerpAPI já foi chamada na API Go; aqui aprofundamos URLs com trafilatura + agente por site."""
    settings = get_settings()
    eff = merge_llm_from_mapping(settings, body.model_dump())
    if not eff.has_any_llm_key:
        raise HTTPException(status_code=503, detail="no LLM API keys configured")
    organic = [h.model_dump() for h in body.organic_results]
    try:
        text = await run_workflow_web_search_enrich(
            eff,
            body.model_provider,
            query=body.query,
            organic=organic,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return WorkflowWebSearchEnrichResponse(text=text)


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


@router.post("/desk/tool-result")
async def post_desk_tool_result(
    body: DeskToolResultRequest,
    _: None = Depends(verify_internal_key),
) -> dict[str, bool]:
    """Recebe resultado de tool executada no cliente (Electron) — M2 TOOL-4."""
    cid = body.conversation_id.strip()
    call_id = body.call_id.strip()
    if not cid or not call_id:
        raise HTTPException(status_code=400, detail="conversation_id and call_id required")
    bridge = get_bridge(cid)
    ok = bridge.submit(call_id, body.result if isinstance(body.result, dict) else {})
    if not ok:
        raise HTTPException(status_code=404, detail="tool_call not pending")
    return {"ok": True}


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities(
    _: None = Depends(verify_internal_key),
) -> CapabilitiesResponse:
    s = get_settings()
    return CapabilitiesResponse(
        openai_configured=bool((s.openai_api_key or "").strip()),
        google_configured=bool((s.google_api_key or "").strip()),
    )
