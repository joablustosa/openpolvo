"""Grafo LangGraph do Zé Polvinho (paridade com o antigo orquestrador Go)."""

from __future__ import annotations

import json
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
    "gerencial_fallback": "geral",
    "geral": "geral",
    "resposta_email": "criacao_email",
    "monitorizacao_email": "criacao_email",
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
        if routed == "geral":
            sys = (
                _system_with_formatting(base, settings)
                + f"\n\n(Nota interna — motivo do encaminhamento geral: {analysis.get('reasoning', '')})"
            )
            if smtp_block:
                sys += smtp_block
            if contacts_block:
                sys += contacts_block
            resp = await chat.ainvoke([SystemMessage(content=sys), *_to_lc_messages(capped)])
        else:
            sys = _system_with_formatting(base, settings) + "\n\nContexto da classificação:\n" + ctx_b
            if routed == "criacao_email" and smtp_block:
                sys += smtp_block
            if routed == "criacao_email" and contacts_block:
                sys += contacts_block
            resp = await chat.ainvoke([SystemMessage(content=sys), *_to_lc_messages(capped)])
        text = str(resp.content).strip()

        meta = {
            "model_provider": mp,
            "intent": str(analysis.get("intent", "")),
            "routed_intent": routed,
            "intent_confidence": float(analysis.get("confidence", 0)),
            "intent_reasoning": str(analysis.get("reasoning", "")),
        }
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
) -> tuple[str, dict[str, Any]]:
    """Executa o grafo LangGraph compilado."""
    graph = get_compiled_graph(settings)
    out = await graph.ainvoke(
        {
            "messages": messages,
            "model_provider": model_provider,
            "smtp_context": smtp_context,
            "contacts_context": contacts_context,
        },
    )
    text = str(out.get("assistant_text", "")).strip()
    meta = out.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    return text, meta
