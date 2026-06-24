"""Metadados de envio de e-mail após resposta do assistente (Desk + Zé Polvinho)."""

from __future__ import annotations

from typing import Any

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.email_send_quality import (
    apply_email_quality_gate,
    email_body_looks_raw_or_incomplete,
    enrich_email_body_for_send,
)
from openpolvointeligence.graphs.message_utils import conversation_summary
from openpolvointeligence.graphs.zepolvinho_graph import (
    _email_send_meta_from_extractor,
    _extract_email_send_draft,
)


def format_smtp_block_for_prompt(smtp_context: dict[str, Any] | None) -> str:
    if not isinstance(smtp_context, dict) or not smtp_context.get("configured"):
        return ""
    return (
        "\n\n## Conta de correio do utilizador (Open Polvo)\n"
        "O utilizador configurou SMTP na aplicação. Qualquer **envio real** de e-mail usa "
        f"esse servidor (remetente: **{smtp_context.get('from_email', '')}**, "
        f"host: `{smtp_context.get('host', '')}:{smtp_context.get('port', '')}`). "
        "Tu preparas assunto, corpo e destinatários; a plataforma envia via API autenticada "
        "com a conta dele. Se pedirem **monitorizar** ou **responder automaticamente** à caixa "
        "de entrada, explica que o envio já usa o SMTP dele, mas **ler** correio na caixa "
        "(IMAP/polling) é uma extensão em roadmap — por agora orienta a colar threads ou usar "
        "reencaminhamento manual se necessário.\n"
    )


async def try_apply_email_send_metadata(
    settings: Settings,
    model_provider: str | None,
    assistant_text: str,
    capped_messages: list[dict[str, Any]],
    smtp_context: dict[str, Any] | None,
    contacts_context: list[dict[str, Any]] | None,
    meta: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(smtp_context, dict) or not smtp_context.get("configured"):
        return meta
    if not str(assistant_text or "").strip():
        return meta
    try:
        raw_draft = await _extract_email_send_draft(
            settings,
            model_provider,
            assistant_text,
            capped_messages,
            contacts_context,
        )
        out = dict(meta)
        out.update(_email_send_meta_from_extractor(raw_draft, contacts_context))
        if out.get("email_send_pending") and isinstance(out.get("email_send_draft"), dict):
            draft0 = out["email_send_draft"]
            b0 = str(draft0.get("body") or "")
            if email_body_looks_raw_or_incomplete(b0):
                try:
                    summ = conversation_summary(capped_messages)
                    new_body = await enrich_email_body_for_send(
                        settings,
                        model_provider,
                        assistant_markdown=assistant_text,
                        draft=draft0,
                        conversation_summary=summ,
                    )
                    if new_body:
                        raw_draft = dict(raw_draft)
                        raw_draft["body"] = new_body
                        out.update(
                            _email_send_meta_from_extractor(raw_draft, contacts_context),
                        )
                except Exception:
                    pass
            apply_email_quality_gate(out)
        return out
    except Exception:
        return meta
