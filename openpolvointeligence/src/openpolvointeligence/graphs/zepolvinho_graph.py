"""Grafo LangGraph do Zé Polvinho (paridade com o antigo orquestrador Go)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Literal, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.message_utils import (
    conversation_summary,
    last_user_text,
    tail_messages,
)
from openpolvointeligence.graphs.models import effective_provider, get_chat_model
from openpolvointeligence.graphs.native_plugins import match_native_plugin
from openpolvointeligence.graphs.finance_context import format_finance_for_prompt
from openpolvointeligence.graphs.task_list_metadata import (
    format_task_lists_for_prompt,
    task_list_ops_metadata_for_reply,
)
from openpolvointeligence.graphs.scheduled_task_metadata import (
    format_sched_tasks_for_prompt,
    sched_ops_metadata_for_reply,
)

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            inner = "\n".join(lines[1:-1]) if lines[-1].strip().startswith("```") else "\n".join(lines[1:])
            return inner.strip()
    return s


def _parse_analysis(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {
            "intent": "geral",
            "confidence": 0.3,
            "reasoning": f"falha ao interpretar JSON do analisador: {raw[:200]}",
            "entities": {},
        }
    return {
        "intent": str(d.get("intent", "geral")),
        "confidence": float(d.get("confidence", 0.5)),
        "reasoning": str(d.get("reasoning", "")),
        "entities": d.get("entities") if isinstance(d.get("entities"), dict) else {},
    }


def _parse_email_draft_json(raw: str) -> dict[str, Any]:
    raw = _strip_json_fence(raw)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return d if isinstance(d, dict) else {}


def _extract_dashboard_json_from_text(text: str) -> dict[str, Any] | None:
    """Extrai o bloco JSON de dashboard directamente do texto do assistente (sem LLM extra)."""
    import re

    # 1) Blocos ```json ... ``` — json.loads completo suporta objectos aninhados (gráficos).
    pos = 0
    while True:
        m = re.search(r"```(?:json)?\s*", text[pos:], re.IGNORECASE)
        if not m:
            break
        inner_start = pos + m.end()
        fence_end = text.find("```", inner_start)
        if fence_end == -1:
            break
        chunk = text[inner_start:fence_end].strip()
        try:
            d = json.loads(chunk)
            if isinstance(d, dict) and "dashboard" in d:
                return d
        except json.JSONDecodeError:
            pass
        pos = fence_end + 3

    # 2) Fallback legado: regex não-ganancioso (só JSON plano com "dashboard" perto do início).
    pattern = re.compile(
        r'```(?:json)?\s*(\{[\s\S]*?"dashboard"[\s\S]*?\})\s*```',
        re.DOTALL,
    )
    for match in pattern.finditer(text):
        try:
            d = json.loads(match.group(1))
            if isinstance(d, dict) and "dashboard" in d:
                return d
        except json.JSONDecodeError:
            continue
    return None


def _contact_id_set(contacts: list[dict[str, Any]] | None) -> set[str]:
    out: set[str] = set()
    for row in contacts or []:
        if isinstance(row, dict):
            cid = str(row.get("id", "")).strip()
            if cid:
                out.add(cid)
    return out


def _valid_uuid_str(s: str) -> bool:
    try:
        uuid.UUID(str(s).strip())
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _email_send_meta_from_extractor(
    d: dict[str, Any],
    contacts_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Campos opcionais para metadata: email_send_draft, email_send_pending, email_send_blocked."""
    out: dict[str, Any] = {}
    if not bool(d.get("wants_send")):
        return out
    subject = str(d.get("subject", "")).strip()
    body = str(d.get("body", "")).strip()
    needs = bool(d.get("needs_user_choice"))
    amb_raw = d.get("ambiguity_note")
    amb_s = str(amb_raw).strip() if amb_raw not in (None, "") else None
    cid_s = str(d.get("contact_id") or "").strip() or None
    to_s = str(d.get("to") or "").strip() or None
    allowed = _contact_id_set(contacts_raw)
    if cid_s and not _valid_uuid_str(cid_s):
        cid_s = None
    if cid_s and allowed and cid_s not in allowed:
        cid_s = None
    if cid_s and contacts_raw:
        for row in contacts_raw:
            if isinstance(row, dict) and str(row.get("id", "")).strip() == cid_s:
                em = str(row.get("email", "")).strip()
                if em and "@" in em and (not to_s):
                    to_s = em
                break
    draft: dict[str, Any] = {
        "contact_id": cid_s,
        "to": to_s,
        "subject": subject,
        "body": body,
        "needs_user_choice": needs,
        "ambiguity_note": amb_s,
    }
    out["email_send_draft"] = draft
    blocked = needs or (not subject) or (not body)
    has_rcpt = bool(cid_s) or (bool(to_s) and "@" in to_s)
    if not has_rcpt:
        blocked = True
    out["email_send_blocked"] = blocked
    out["email_send_pending"] = bool(not blocked and has_rcpt)
    return out


async def _extract_email_send_draft(
    settings: Settings,
    model_provider: str | None,
    assistant_markdown: str,
    capped_msgs: list[dict[str, Any]],
    contacts_raw: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    contacts_json = json.dumps(contacts_raw or [], ensure_ascii=False)
    summary = conversation_summary(capped_msgs)
    clip = assistant_markdown[:14000]
    sys = f"""És um extrator de dados para envio de e-mail. Responde APENAS com um único objeto JSON (sem markdown).
Chaves obrigatórias:
- "wants_send": boolean — true só se o utilizador pediu explicitamente para **enviar**, **mandar** ou **disparar** o e-mail pela aplicação. Se só pediu para redigir ou sugerir texto, false.
- "contact_id": string UUID ou null — id do contacto na lista JSON quando o destinatário vem da agenda.
- "to": string ou null — e-mail do destinatário quando conhecido.
- "subject": string — assunto em português com gramática e ortografia correctas.
- "body": string — corpo em texto simples (usa \\n).
- "needs_user_choice": boolean — true se houver ambiguidade entre destinatários.
- "ambiguity_note": string ou null.

Lista de contactos (JSON): {contacts_json}

Resumo da conversa: {summary}

Resposta do assistente a interpretar:
---
{clip}
---
Não inventes contact_id que não exista na lista."""
    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke(
        [SystemMessage(content=sys), HumanMessage(content="Extrai o JSON.")],
    )
    return _parse_email_draft_json(str(resp.content))


# Aliases do analisador → chave interna de encaminhamento
_INTENT_ALIASES: dict[str, str] = {
    "duvida_tecnica_tutorial": "duvida",
    "duvida": "duvida",
    "conversa_social": "conversa",
    "conversa": "conversa",
    "suporte_erro_feedback": "suporte",
    "suporte": "suporte",
    "configuracao_perfil": "config",
    "config": "config",
    "pedido_conteudo_generico": "pedido_conteudo",
    "pedido_conteudo": "pedido_conteudo",
    "analise_dados_relatorios": "pedido_dados",
    "pedido_dados": "pedido_dados",
    "execucao_automacao": "automacao",
    "automacao": "automacao",
    "agendamento": "agendamento",
    "agendar": "agendamento",
    "gerencial_fallback": "geral",
    "geral": "geral",
    "resposta_email": "criacao_email",
    "monitorizacao_email": "criacao_email",
    "criacao_app_interativa": "criacao_app_interativa",
}

# Rota normalizada → ficheiro de prompt em prompts/{stem}.md (sem extensão)
_ROUTE_TO_STEM: dict[str, str] = {
    "duvida": "specialist_duvida",
    "conversa": "specialist_conversa",
    "suporte": "specialist_suporte",
    "config": "specialist_config",
    "pedido_conteudo": "specialist_pedido_conteudo",
    "pedido_dados": "specialist_pedido_dados",
    "automacao": "specialist_automacao",
    "geral": "specialist_geral",
    "criacao_automacao": "specialist_criacao_automacao",
    "criacao_sistema_web": "specialist_criacao_sistema_web",
    "post_instagram": "specialist_post_instagram",
    "post_facebook": "specialist_post_facebook",
    "post_linkedin": "specialist_post_linkedin",
    "post_twitter_x": "specialist_post_twitter_x",
    "planilha_estrategia_precos": "specialist_planilha_estrategia_precos",
    "criacao_email": "specialist_criacao_email",
    "pesquisa_web_tempo_real": "specialist_pesquisa_web_tempo_real",
    "visao_computacional_analise": "specialist_visao_computacional_analise",
    "geracao_midia_ai": "specialist_geracao_midia_ai",
    "gestao_tarefas_calendario": "specialist_gestao_tarefas_calendario",
    "financas_pessoais": "specialist_financas_pessoais",
    "agendamento": "specialist_agendamento",
    # O Builder é um sub-grafo (não um prompt de especialista), mas precisa de estar
    # no mapa para passar pelo `route_intent`. O despacho acontece em `node_specialist`.
    "criacao_app_interativa": "specialist_geral",
}

# Intenções válidas após normalização (chaves finais do router)
_ROUTABLE: frozenset[str] = frozenset(_ROUTE_TO_STEM.keys())


def _normalize_intent(raw: str) -> str:
    r = (raw or "geral").strip() or "geral"
    return _INTENT_ALIASES.get(r, r)


def route_intent(intent: str, confidence: float) -> str:
    if confidence < 0.4:
        return "geral"
    n = _normalize_intent(intent)
    if n in _ROUTABLE:
        return n
    return "geral"


def _user_intent_requests_code_application(user_lower: str) -> bool:
    """Sinais de pedido de código/site/app (Builder), não só tarefa na lista Open Polvo."""
    code_hints = (
        " aplic",
        " website",
        " site ",
        " front",
        " back",
        " react",
        " next",
        " vite",
        " crud",
        " api ",
        " interface",
        " ui ",
        " págin",
        " pagin",
        " html",
        " css",
        " javascript",
        " typescript",
        " projeto código",
        " projeto codigo",
        " código fonte",
        " codigo fonte",
        " webapp",
        " web app",
        " fullstack",
        " deploy",
        " servidor",
        "localhost",
        "kanban completo",
        "app de tarefas",
        "aplicação de tarefas",
        "aplicacao de tarefas",
    )
    return any(h in user_lower for h in code_hints)


def _prefer_task_lists_over_builder(
    user_text: str,
    task_lists_context: list[dict[str, Any]] | None,
) -> bool:
    """
    Se o utilizador tem listas na app e o texto fala em tarefas/itens sem pedir
    aplicação ou código, não despachar o Builder (evita confusão com «criar tarefa»).
    """
    if not isinstance(task_lists_context, list) or len(task_lists_context) == 0:
        return False
    t = (user_text or "").strip().lower()
    if not t:
        return False
    list_hints = (
        "lista de tarefas",
        "minha lista",
        "na lista",
        "à lista",
        "a lista",
        "adiciona",
        "adicionar",
        "cria uma tarefa",
        "criar uma tarefa",
        "criar tarefa",
        "nova tarefa",
        "novo item",
        "item na",
        "marcar como",
        "marca como",
        "concluída",
        "concluida",
        "feito",
        "pendente",
        "apagar tarefa",
        " remover ",
        "renomear l",
        "tarefas da",
        "itens da",
        "executor da lista",
    )
    if not any(h in t for h in list_hints):
        return False
    if _user_intent_requests_code_application(t):
        return False
    return True


def _build_classification_ctx(analysis: dict[str, Any]) -> str:
    enc = json.dumps(analysis.get("entities") or {}, ensure_ascii=False)
    return (
        f'INTENT: {analysis.get("intent")} (confiança: {float(analysis.get("confidence", 0)) * 100:.0f}%)'
        f'\nREASONING: {analysis.get("reasoning", "")}\nENTITIES: {enc}'
    )


def _system_with_formatting(base: str, settings: Settings) -> str:
    fmt = _load_prompt("response_formatting").strip()
    b = base.strip()
    if not fmt:
        return b
    return f"{b}\n\n{fmt}"


def _to_lc_messages(msgs: list[dict[str, Any]]) -> list[Any]:
    out: list[Any] = []
    for m in msgs:
        r = str(m.get("role", "")).strip().lower()
        c = str(m.get("content", ""))
        if r in ("assistant", "ai"):
            out.append(AIMessage(content=c))
        else:
            out.append(HumanMessage(content=c))
    return out


class ZepState(TypedDict, total=False):
    messages: list[dict[str, Any]]
    model_provider: str
    conversation_id: str | None
    smtp_context: dict[str, Any] | None
    contacts_context: list[dict[str, Any]] | None
    task_lists_context: list[dict[str, Any]] | None
    finance_context: dict[str, Any] | None
    meta_context: dict[str, Any] | None
    scheduled_tasks_context: list[dict[str, Any]] | None
    plugin_hit: bool
    assistant_text: str
    metadata: dict[str, Any]
    analysis: dict[str, Any]


def build_zepolvinho_graph(settings: Settings):
    analyzer_system = _load_prompt("analyzer_system")
    _stem_text: dict[str, str] = {}
    for _stem in sorted(set(_ROUTE_TO_STEM.values())):
        _stem_text[_stem] = _load_prompt(_stem)
    route_prompts = {route: _stem_text[stem] for route, stem in _ROUTE_TO_STEM.items()}

    async def node_native(state: ZepState) -> dict[str, Any]:
        msgs = state.get("messages") or []
        last = last_user_text(msgs, 2000)
        hit = match_native_plugin(last)
        if hit:
            pid, url, label = hit
            mp = effective_provider(state.get("model_provider"))
            return {
                "plugin_hit": True,
                "assistant_text": f"A abrir **{label}** no painel ao lado.",
                "metadata": {
                    "model_provider": mp,
                    "intent": "native_plugin",
                    "routed_intent": "native_plugin",
                    "native_plugin": {"id": pid, "url": url, "label": label},
                },
            }
        return {"plugin_hit": False}

    def route_after_native(s: ZepState) -> Literal["end", "analyze"]:
        return "end" if s.get("plugin_hit") else "analyze"

    async def node_analyze(state: ZepState) -> dict[str, Any]:
        msgs = state.get("messages") or []
        if not msgs:
            return {
                "analysis": {
                    "intent": "geral",
                    "confidence": 0.3,
                    "reasoning": "sem mensagens",
                    "entities": {},
                }
            }
        capped = tail_messages(msgs)
        summary = conversation_summary(capped)
        chat = get_chat_model(settings, state.get("model_provider"), json_mode=True)
        sys1 = SystemMessage(content=analyzer_system)
        sys2 = SystemMessage(content="HISTÓRICO RECENTE DA CONVERSA:\n" + summary)
        hist = _to_lc_messages(capped)
        resp = await chat.ainvoke([sys1, sys2, *hist])
        raw = str(resp.content).strip()
        if not raw:
            analysis = {
                "intent": "geral",
                "confidence": 0.3,
                "reasoning": "resposta vazia do analisador",
                "entities": {},
            }
        else:
            analysis = _parse_analysis(raw)
        return {"analysis": analysis}

    async def node_specialist(state: ZepState) -> dict[str, Any]:
        msgs = state.get("messages") or []
        analysis = state.get("analysis") or {}
        routed = route_intent(str(analysis.get("intent", "geral")), float(analysis.get("confidence", 0)))
        capped = tail_messages(msgs)
        ctx_b = _build_classification_ctx(analysis)
        mp = effective_provider(state.get("model_provider"))

        tlc_raw = state.get("task_lists_context")
        tlc_list = tlc_raw if isinstance(tlc_raw, list) else None
        if routed == "criacao_app_interativa" and _prefer_task_lists_over_builder(
            last_user_text(msgs, 4000),
            tlc_list,
        ):
            routed = "gestao_tarefas_calendario"

        # Despacho para o sub-grafo Builder (Lovable-like): gera uma app completa
        # com preview + ficheiros e devolve tudo em metadata.builder.
        if routed == "criacao_app_interativa":
            try:
                from openpolvointeligence.graphs.builder_subgraph import run_builder

                user_req = last_user_text(msgs, 4000)
                artifact = await run_builder(settings, user_req, state.get("model_provider"))
                title = str(artifact.get("title") or "Aplicação")
                desc = str(artifact.get("description") or "").strip()
                msg = f"**{title}** pronta. Abre o painel à direita para ver o preview e o código."
                if desc:
                    msg += f"\n\n{desc}"
                return {
                    "assistant_text": msg,
                    "metadata": {
                        "model_provider": mp,
                        "intent": str(analysis.get("intent", "")),
                        "routed_intent": routed,
                        "intent_confidence": float(analysis.get("confidence", 0)),
                        "intent_reasoning": str(analysis.get("reasoning", "")),
                        "builder": artifact,
                    },
                }
            except Exception as exc:  # noqa: BLE001 — fallback defensivo para não quebrar o chat
                import logging as _lg

                _lg.getLogger(__name__).exception("builder subgraph failed: %s", exc)
                return {
                    "assistant_text": (
                        "Tentei gerar a aplicação mas o Builder falhou. "
                        "Tenta reformular o pedido com mais detalhes sobre o que queres construir."
                    ),
                    "metadata": {
                        "model_provider": mp,
                        "intent": str(analysis.get("intent", "")),
                        "routed_intent": routed,
                        "builder_error": str(exc)[:400],
                    },
                }

        chat = get_chat_model(settings, state.get("model_provider"), json_mode=False)

        base = route_prompts.get(routed) or route_prompts["geral"]
        contacts_block = ""
        cc = state.get("contacts_context")
        if isinstance(cc, list) and len(cc) > 0:
            lines = []
            for row in cc[:80]:
                if not isinstance(row, dict):
                    continue
                cid = str(row.get("id", "")).strip()
                nm = str(row.get("name", "")).strip()
                em = str(row.get("email", "")).strip()
                ph = str(row.get("phone", "")).strip()
                if not cid or not nm:
                    continue
                extra = f", tel. {ph}" if ph else ""
                lines.append(f"- **{nm}** (id `{cid}`) — {em}{extra}")
            if lines:
                contacts_block = (
                    "\n\n## Contactos guardados na plataforma\n"
                    "O utilizador tem estes contactos na agenda. Quando pedirem para **enviar e-mail** "
                    "a alguém pelo **nome**, corresponde ao contacto e indica o **id** e o **email** "
                    "correctos. Para envio real, a API usa `POST /v1/email/send` com `contact_id` ou `to`.\n"
                    + "\n".join(lines)
                )
        smtp_block = ""
        sc = state.get("smtp_context")
        if isinstance(sc, dict) and sc.get("configured"):
            smtp_block = (
                "\n\n## Conta de correio do utilizador (Open Polvo)\n"
                "O utilizador configurou SMTP na aplicação. Qualquer **envio real** de e-mail usa "
                f"esse servidor (remetente: **{sc.get('from_email', '')}**, host: `{sc.get('host', '')}:{sc.get('port', '')}`). "
                "Tu preparas assunto, corpo e destinatários; a plataforma envia via API autenticada com a conta dele. "
                "Se pedirem **monitorizar** ou **responder automaticamente** à caixa de entrada, explica que o envio "
                "já usa o SMTP dele, mas **ler** correio na caixa (IMAP/polling) é uma extensão em roadmap — "
                "por agora orienta a colar threads ou usar reencaminhamento manual se necessário.\n"
            )
        task_lists_block = ""
        if isinstance(tlc_list, list) and len(tlc_list) > 0:
            body_tl = format_task_lists_for_prompt(tlc_list)
            if body_tl:
                task_lists_block = (
                    "\n\n## Listas de tarefas na plataforma (Open Polvo)\n"
                    "Estado actual das listas do utilizador (cada linha tem IDs UUID). "
                    "Se pedirem para **criar, renomear, apagar, adicionar ou editar tarefas**, ou **executar a lista** "
                    "(processar com o agente executor), explica claramente o plano; a app pode aplicar as mudanças "
                    "via API autenticada do utilizador com base num extracción automática após esta resposta.\n"
                    + body_tl
                )
        finance_block = ""
        fc_raw = state.get("finance_context")
        if routed == "financas_pessoais" and isinstance(fc_raw, dict) and len(fc_raw) > 0:
            body_fc = format_finance_for_prompt(fc_raw)
            if body_fc:
                finance_block = (
                    "\n\n## Dados de finanças (JSON)\n"
                    "Contexto vindo da API Open Polvo (categorias, transacções recentes, totais do mês, assinaturas).\n"
                    + body_fc
                )
        sched_raw = state.get("scheduled_tasks_context")
        sched_list = sched_raw if isinstance(sched_raw, list) else None
        sched_block = ""
        if isinstance(sched_list, list) and len(sched_list) > 0:
            body_sc = format_sched_tasks_for_prompt(sched_list)
            if body_sc:
                sched_block = (
                    "\n\n## Automações agendadas existentes\n"
                    "O utilizador tem estas tarefas agendadas configuradas (IDs UUID reais — "
                    "usa-os para update/delete/toggle, nunca inventes novos).\n"
                    + body_sc
                )

        meta_block = ""
        mc = state.get("meta_context")
        if isinstance(mc, dict):
            parts: list[str] = []
            if mc.get("whatsapp_configured"):
                parts.append(f"WhatsApp (Phone Number ID: `{mc.get('wa_phone_number_id', '')}`) ✓ configurado")
            if mc.get("facebook_configured"):
                parts.append(f"Facebook Page (Page ID: `{mc.get('fb_page_id', '')}`) ✓ configurado")
            if mc.get("instagram_configured"):
                parts.append(f"Instagram Business (Account ID: `{mc.get('ig_account_id', '')}`) ✓ configurado")
            if parts:
                meta_block = (
                    "\n\n## Integração Meta do utilizador (Open Polvo)\n"
                    "O utilizador tem as seguintes plataformas Meta configuradas:\n"
                    + "\n".join(f"- {p}" for p in parts)
                    + "\n\nPodes programar **posts** (Facebook/Instagram) via API `POST /v1/meta/content` "
                    "com `{platform, message, image_url}`, e enviar **mensagens WhatsApp** via `POST /v1/meta/message` "
                    "com `{platform: 'whatsapp', to, text}`. Nunca inventes IDs ou tokens — usa os fornecidos acima."
                )
        if routed == "geral":
            sys = (
                _system_with_formatting(base, settings)
                + f"\n\n(Nota interna — motivo do encaminhamento geral: {analysis.get('reasoning', '')})"
            )
            if smtp_block:
                sys += smtp_block
            if contacts_block:
                sys += contacts_block
            if meta_block:
                sys += meta_block
            resp = await chat.ainvoke([SystemMessage(content=sys), *_to_lc_messages(capped)])
        else:
            sys = _system_with_formatting(base, settings) + "\n\nContexto da classificação:\n" + ctx_b
            if routed == "criacao_email" and smtp_block:
                sys += smtp_block
            if routed == "criacao_email" and contacts_block:
                sys += contacts_block
            if routed == "gestao_tarefas_calendario" and task_lists_block:
                sys += task_lists_block
            if routed == "financas_pessoais" and finance_block:
                sys += finance_block
            if routed == "agendamento" and sched_block:
                sys += sched_block
            if meta_block and routed in ("post_instagram", "post_facebook", "automacao", "pedido_conteudo"):
                sys += meta_block
            resp = await chat.ainvoke([SystemMessage(content=sys), *_to_lc_messages(capped)])
        text = str(resp.content).strip()

        meta: dict[str, Any] = {
            "model_provider": mp,
            "intent": str(analysis.get("intent", "")),
            "routed_intent": routed,
            "intent_confidence": float(analysis.get("confidence", 0)),
            "intent_reasoning": str(analysis.get("reasoning", "")),
        }
        if routed == "criacao_email" and isinstance(sc, dict) and sc.get("configured"):
            try:
                raw_draft = await _extract_email_send_draft(
                    settings,
                    state.get("model_provider"),
                    text,
                    capped,
                    cc if isinstance(cc, list) else None,
                )
                meta.update(
                    _email_send_meta_from_extractor(
                        raw_draft,
                        cc if isinstance(cc, list) else None,
                    ),
                )
            except Exception:
                pass
        if routed in ("pedido_dados", "analise_dados_relatorios"):
            dashboard_json = _extract_dashboard_json_from_text(text)
            if dashboard_json:
                meta.update(dashboard_json)
        if routed == "gestao_tarefas_calendario":
            try:
                meta.update(
                    await task_list_ops_metadata_for_reply(
                        settings,
                        state.get("model_provider"),
                        text,
                        capped,
                        tlc_list,
                    ),
                )
            except Exception:
                pass
        if routed == "agendamento":
            try:
                meta.update(
                    await sched_ops_metadata_for_reply(
                        settings,
                        state.get("model_provider"),
                        text,
                        capped,
                        sched_list,
                    ),
                )
            except Exception:
                pass
        return {"assistant_text": text, "metadata": meta}

    g = StateGraph(ZepState)
    g.add_node("native", node_native)
    g.add_node("analyze", node_analyze)
    g.add_node("specialist", node_specialist)
    g.add_edge(START, "native")
    g.add_conditional_edges("native", route_after_native, {"end": END, "analyze": "analyze"})
    g.add_edge("analyze", "specialist")
    g.add_edge("specialist", END)
    return g.compile()


_compiled_graph: Any = None


def get_compiled_graph(settings: Settings) -> Any:
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_zepolvinho_graph(settings)
    return _compiled_graph


def reset_graph_cache() -> None:
    """Para testes."""
    global _compiled_graph
    _compiled_graph = None


async def run_reply(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    smtp_context: dict[str, Any] | None = None,
    contacts_context: list[dict[str, Any]] | None = None,
    task_lists_context: list[dict[str, Any]] | None = None,
    finance_context: dict[str, Any] | None = None,
    meta_context: dict[str, Any] | None = None,
    scheduled_tasks_context: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Executa o grafo LangGraph compilado."""
    graph = get_compiled_graph(settings)
    out = await graph.ainvoke(
        {
            "messages": messages,
            "model_provider": model_provider,
            "smtp_context": smtp_context,
            "contacts_context": contacts_context,
            "task_lists_context": task_lists_context,
            "finance_context": finance_context,
            "meta_context": meta_context,
            "scheduled_tasks_context": scheduled_tasks_context,
        },
    )
    text = str(out.get("assistant_text", "")).strip()
    meta = out.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    return text, meta


async def run_reply_stream(
    settings: Settings,
    messages: list[dict[str, Any]],
    model_provider: str,
    smtp_context: dict[str, Any] | None = None,
    contacts_context: list[dict[str, Any]] | None = None,
    task_lists_context: list[dict[str, Any]] | None = None,
    finance_context: dict[str, Any] | None = None,
    meta_context: dict[str, Any] | None = None,
    scheduled_tasks_context: list[dict[str, Any]] | None = None,
):
    """Versão SSE de run_reply — sem timeout HTTP.

    Estratégia:
    1. Verifica plugins nativos (instantâneo).
    2. Corre APENAS o nó de análise de intenção (1 LLM call, <10s).
    3. Se builder → delega ao run_builder_stream que emite ficheiros à medida
       que são gerados, eliminando o context deadline exceeded.
    4. Para outras intenções → corre o grafo completo (rápido, <30s) e emite
       um único evento "done".
    """
    import logging as _lg

    from langchain_core.messages import SystemMessage

    from openpolvointeligence.graphs.builder_subgraph import run_builder_stream
    from openpolvointeligence.graphs.message_utils import (
        conversation_summary,
        last_user_text,
        tail_messages,
    )
    from openpolvointeligence.graphs.models import effective_provider, get_chat_model
    from openpolvointeligence.graphs.native_plugins import match_native_plugin

    _log = _lg.getLogger(__name__)
    mp = effective_provider(model_provider)

    # ── Plugins nativos (resposta instantânea) ──────────────────────────────────
    last = last_user_text(messages, 2000)
    hit = match_native_plugin(last)
    if hit:
        pid, url, label = hit
        yield {
            "type": "done",
            "assistant_text": f"A abrir **{label}** no painel ao lado.",
            "metadata": {
                "model_provider": mp,
                "intent": "native_plugin",
                "routed_intent": "native_plugin",
                "native_plugin": {"id": pid, "url": url, "label": label},
            },
        }
        return

    # ── Análise de intenção (apenas este nó — rápido) ───────────────────────────
    yield {"type": "progress", "step": "analyze", "label": "A analisar o pedido..."}

    try:
        analyzer_system = _load_prompt("analyzer_system")
        capped = tail_messages(messages)
        summary = conversation_summary(capped)
        chat_analyze = get_chat_model(settings, model_provider, json_mode=True)
        resp = await chat_analyze.ainvoke([
            SystemMessage(content=analyzer_system),
            SystemMessage(content="HISTÓRICO RECENTE DA CONVERSA:\n" + summary),
            *_to_lc_messages(capped),
        ])
        raw = str(resp.content).strip()
        analysis = _parse_analysis(raw) if raw else {
            "intent": "geral", "confidence": 0.3, "reasoning": "", "entities": {},
        }
    except Exception as exc:
        _log.warning("análise de intenção falhou: %s — usando geral", exc)
        analysis = {"intent": "geral", "confidence": 0.3, "reasoning": "", "entities": {}}

    routed = route_intent(str(analysis.get("intent", "geral")), float(analysis.get("confidence", 0)))

    if routed == "criacao_app_interativa" and _prefer_task_lists_over_builder(
        last_user_text(messages, 4000),
        task_lists_context,
    ):
        routed = "gestao_tarefas_calendario"

    # ── Builder: streaming nó a nó ──────────────────────────────────────────────
    if routed == "criacao_app_interativa":
        user_req = last_user_text(messages, 4000)
        try:
            async for event in run_builder_stream(settings, user_req, model_provider):
                if event.get("type") == "done":
                    artifact = event.get("artifact", {})
                    title = str(artifact.get("title") or "Aplicação")
                    desc = str(artifact.get("description") or "").strip()
                    msg = f"**{title}** pronta. Abre o painel à direita para ver o preview e o código."
                    if desc:
                        msg += f"\n\n{desc}"
                    yield {
                        "type": "done",
                        "assistant_text": msg,
                        "metadata": {
                            "model_provider": mp,
                            "intent": "criacao_app_interativa",
                            "routed_intent": "criacao_app_interativa",
                            "builder": artifact,
                        },
                    }
                else:
                    yield event
        except Exception as exc:
            _log.exception("run_builder_stream falhou: %s", exc)
            yield {"type": "error", "detail": str(exc)[:400]}
        return

    # ── Outras intenções: grafo completo (rápido) ───────────────────────────────
    yield {"type": "progress", "step": "specialist", "label": "A preparar resposta..."}
    try:
        text, meta = await run_reply(
            settings,
            messages,
            model_provider,
            smtp_context,
            contacts_context,
            task_lists_context,
            finance_context,
            meta_context,
            scheduled_tasks_context,
        )
        yield {"type": "done", "assistant_text": text, "metadata": meta}
    except Exception as exc:
        _log.exception("run_reply falhou no stream: %s", exc)
        yield {"type": "error", "detail": str(exc)[:400]}
