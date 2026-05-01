"""Qualidade do corpo de e-mail: evitar envio automático com listagens SerpAPI / só links."""

from __future__ import annotations

import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import get_chat_model

_RAW_SERP_MARKERS = (
    "resultados google",
    "resultados duckduckgo",
    "serpapi.com",
    "### motor:",
    "engine: google",
    "engine: duckduckgo",
)


def email_body_looks_raw_or_incomplete(body: str) -> bool:
    """True se o corpo parece lista de SERP / só links — não deve ir para envio automático."""
    b = (body or "").strip().lower()
    if len(b) < 80:
        return True
    for m in _RAW_SERP_MARKERS:
        if m in b:
            return True
    # Muitas linhas que são quase só URL
    lines = [ln.strip() for ln in (body or "").splitlines() if ln.strip()]
    if len(lines) >= 3:
        url_lines = sum(1 for ln in lines if re.match(r"^https?://", ln, re.I))
        if url_lines >= 3 and len(b) < 1200:
            return True
    # Pouco texto além de URLs (heurística simples)
    words = re.findall(r"[a-záàâãéêíóôõúç]{3,}", b, flags=re.I)
    urls = len(re.findall(r"https?://[^\s)]+", body or "", flags=re.I))
    if urls >= 3 and len(words) < 40:
        return True
    return False


async def enrich_email_body_for_send(
    settings: Settings,
    model_provider: str | None,
    *,
    assistant_markdown: str,
    draft: dict[str, Any],
    conversation_summary: str,
) -> str:
    """Reescreve o corpo do e-mail como newsletter/síntese completa (sem listagens SerpAPI)."""
    subj = str(draft.get("subject") or "").strip()
    prev_body = str(draft.get("body") or "").strip()
    sys = """És o **redactor final** de e-mails da plataforma Open Polvo.

O utilizador pediu que o e-mail fosse **enviado pela app**. O rascunho actual contém listagens brutas de pesquisa (ex.: «Resultados Google», só links) ou está incompleto.

## A tua saída

Responde **apenas** com o **corpo final do e-mail** (texto simples, quebras de linha), em **português europeu**, pronto para o destinatário ler no cliente de correio.

## Regras

1. **Proíbido** incluir blocos «Resultados Google/DuckDuckGo», linhas numeradas só com URL, ou formato de ferramenta SerpAPI.
2. No topo: **2–4 bullets** com os temas/notícias mais relevantes — **síntese com as tuas palavras**, não copiar só títulos.
3. Secção **«Em detalhe»**: até **5** parágrafos curtos (cada um uma linha temática ou notícia), com contexto útil. Se não houver dados no material, escreve «sugestão: confirmar na fonte X» em vez de inventar factos.
4. Fecha com uma linha de **assinatura** discreta (ex.: «Com os melhores cumprimentos»).
5. Não uses markdown (sem #, sem **). Tom de newsletter profissional.
6. Mínimo ~350 palavras quando houver conteúdo de apoio suficiente; se o material for escasso, explica a lacuna com honestidade."""
    user = (
        f"## Assunto acordado\n{subj}\n\n"
        f"## Resumo da conversa\n{conversation_summary[:4000]}\n\n"
        f"## Rascunho a substituir\n{prev_body[:8000]}\n\n"
        f"## Resposta do assistente (contexto completo)\n{assistant_markdown[:14000]}"
    )
    chat = get_chat_model(settings, model_provider, json_mode=False)
    resp = await chat.ainvoke(
        [SystemMessage(content=sys), HumanMessage(content=user)],
    )
    return str(resp.content or "").strip()


def apply_email_quality_gate(meta: dict[str, Any]) -> None:
    """Se o corpo ainda for bruto/incompleto, impede envio automático (muta meta in-place)."""
    draft = meta.get("email_send_draft")
    if not isinstance(draft, dict):
        return
    body = str(draft.get("body") or "")
    if not meta.get("email_send_pending"):
        return
    if not email_body_looks_raw_or_incomplete(body):
        return
    meta["email_send_blocked"] = True
    meta["email_send_pending"] = False
    meta["email_send_quality_note"] = (
        "O corpo do e-mail ainda parecia incompleto (ex.: só links ou saída de pesquisa bruta). "
        "Edita o rascunho ou pede uma versão final consolidada antes de enviar."
    )
