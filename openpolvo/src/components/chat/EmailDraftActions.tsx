import { useEffect, useState } from "react";
import { Loader2, Send, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildEmailSendPayload,
  emailBodyLooksRawOrIncomplete,
  parseEmailMessageMeta,
  type EmailSendDraft,
} from "@/lib/emailChatMetadata";
import * as mail from "@/lib/mailApi";

type Props = {
  token: string;
  messageId: string;
  metadata: unknown;
  onSent?: () => void;
};

function draftHasRecipient(d: EmailSendDraft): boolean {
  const cid = (d.contact_id || "").trim();
  const to = (d.to || "").trim();
  return Boolean(cid) || (Boolean(to) && to.includes("@"));
}

export function EmailDraftActions({ token, messageId, metadata, onSent }: Props) {
  const parsed = parseEmailMessageMeta(metadata);
  const draft = parsed?.email_send_draft;
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMode, setBusyMode] = useState<"once" | "always" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [smtpLine, setSmtpLine] = useState<string | null>(null);
  const [skipDirectEnabled, setSkipDirectEnabled] = useState(false);
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.body ?? "");
  }, [draft?.subject, draft?.body, messageId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await mail.getSmtpSettings(token);
        if (cancelled) return;
        setSkipDirectEnabled(Boolean(s.email_chat_skip_confirmation));
        const from = (s.from_email || "").trim();
        const host = (s.host || "").trim();
        const port = s.port || 587;
        if (from || host) {
          setSmtpLine(
            [from && `De: ${from}`, host && `Servidor: ${host}:${port}`].filter(Boolean).join(" · "),
          );
        }
      } catch {
        if (!cancelled) {
          setSmtpLine(null);
          setSkipDirectEnabled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (dismissed || sent || !draft) return null;

  const pending = Boolean(parsed?.email_send_pending);
  const blocked = Boolean(parsed?.email_send_blocked);
  const toLabel = draft.contact_id
    ? `Contacto (${draft.contact_id.slice(0, 8)}…)`
    : draft.to || "—";

  const hasRcpt = draftHasRecipient(draft);
  const ambiguous = Boolean(draft.needs_user_choice);
  /** Mostrar editor + botões: há destinatário no rascunho e sem ambiguidade (podes completar assunto/corpo vazios). */
  const showComposer = !ambiguous && (pending || blocked) && hasRcpt;

  async function persistSendWithoutConfirm(): Promise<void> {
    const s = await mail.getSmtpSettings(token);
    await mail.putSmtpSettings(token, {
      host: (s.host || "").trim(),
      port: s.port || 587,
      username: (s.username || "").trim(),
      from_email: (s.from_email || "").trim(),
      from_name: (s.from_name || "").trim(),
      use_tls: s.use_tls !== false,
      email_chat_skip_confirmation: true,
    });
    setSkipDirectEnabled(true);
  }

  function buildPayloadOrErr(): { ok: true; payload: ReturnType<typeof buildEmailSendPayload> } | { ok: false; msg: string } {
    const d: EmailSendDraft = {
      ...draft,
      subject: subject.trim(),
      body: body.trim(),
    };
    const payload = buildEmailSendPayload(d);
    if (!payload.subject || !payload.body) {
      return { ok: false, msg: "Assunto e corpo são obrigatórios." };
    }
    if (emailBodyLooksRawOrIncomplete(payload.body)) {
      return {
        ok: false,
        msg: "O corpo ainda parece incompleto (ex.: só links ou «Resultados Google»). Edita o texto ou pede uma versão final no chat antes de enviar.",
      };
    }
    if (!payload.contact_id && !(payload.to && payload.to.includes("@"))) {
      return { ok: false, msg: "Destinatário inválido." };
    }
    return { ok: true, payload };
  }

  async function sendOnce() {
    const r = buildPayloadOrErr();
    if (!r.ok) {
      setErr(r.msg);
      return;
    }
    setBusy(true);
    setBusyMode("once");
    setErr(null);
    try {
      await mail.sendEmail(token, r.payload);
      setSent(true);
      onSent?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setBusy(false);
      setBusyMode(null);
    }
  }

  async function sendAndDisableFutureConfirmations() {
    const r = buildPayloadOrErr();
    if (!r.ok) {
      setErr(r.msg);
      return;
    }
    setBusy(true);
    setBusyMode("always");
    setErr(null);
    try {
      await persistSendWithoutConfirm();
      await mail.sendEmail(token, r.payload);
      setSent(true);
      onSent?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar preferência ou enviar");
    } finally {
      setBusy(false);
      setBusyMode(null);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
      <p className="font-medium text-foreground">Confirmar envio de e-mail</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Revê o destinatário e o texto. Podes enviar só esta vez ou activar o envio directo (como «Run» / «Always» no Cursor) —
        fica guardado em Definições › Correio.
      </p>
      {smtpLine ? <p className="text-[11px] text-muted-foreground">{smtpLine}</p> : null}
      <div className="space-y-1">
        <span className="text-[10px] uppercase text-muted-foreground">Para</span>
        <p className="font-mono text-[11px] text-foreground">{toLabel}</p>
        {draft.contact_id && draft.to ? (
          <p className="text-[11px] text-muted-foreground">{draft.to}</p>
        ) : null}
      </div>
      {ambiguous || (blocked && !showComposer) ? (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-100">
          {draft.ambiguity_note?.trim() ||
            "Não foi possível preparar o envio: confirme o destinatário ou reformule o pedido."}
        </p>
      ) : null}
      {blocked && !showComposer && (subject || body) ? (
        <div className="space-y-1 rounded border border-border/60 bg-muted/20 p-2 text-[11px]">
          <p className="font-medium text-foreground">Pré-visualização (não enviado)</p>
          {subject ? <p className="text-muted-foreground">Assunto: {subject}</p> : null}
          {body ? <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-foreground">{body}</pre> : null}
        </div>
      ) : null}
      {showComposer ? (
        <>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-muted-foreground">Assunto</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-muted-foreground">Corpo</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[100px] text-xs"
            />
          </div>
          {err ? <p className="text-destructive">{err}</p> : null}
          <div className="flex flex-col gap-2 border-t border-border/50 pt-2 sm:flex-row sm:items-stretch sm:justify-between sm:gap-3">
            <Button
              type="button"
              size="sm"
              className="min-h-9 flex-1 gap-1.5 sm:min-w-0"
              disabled={busy}
              onClick={() => void sendOnce()}
            >
              {busy && busyMode === "once" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5 shrink-0" />
              )}
              Confirmar envio (uma vez)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-9 flex-1 gap-1.5 sm:min-w-0"
              disabled={busy || skipDirectEnabled}
              title={
                skipDirectEnabled
                  ? "O envio directo já está activo nas definições."
                  : "Guarda a preferência e envia este e-mail; nos próximos pedidos o envio será automático."
              }
              onClick={() => void sendAndDisableFutureConfirmations()}
            >
              {busy && busyMode === "always" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5 shrink-0" />
              )}
              Enviar e não pedir mais
            </Button>
          </div>
          {skipDirectEnabled ? (
            <p className="text-[11px] text-muted-foreground">
              Envio directo já está ligado em Definições › Correio — usa só «Confirmar envio (uma vez)» se precisares de rever
              antes de cada envio.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              «Enviar e não pedir mais» actualiza a opção «Enviar directamente» nas definições de SMTP e envia já.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={busy} onClick={() => setDismissed(true)}>
              Cancelar
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
