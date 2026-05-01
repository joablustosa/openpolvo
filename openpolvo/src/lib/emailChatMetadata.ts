/** Rascunho devolvido pelo Intelligence em metadata da mensagem do assistente. */
export type EmailSendDraft = {
  contact_id?: string | null;
  to?: string | null;
  subject?: string;
  body?: string;
  needs_user_choice?: boolean;
  ambiguity_note?: string | null;
};

export type ParsedEmailMessageMeta = {
  email_send_pending?: boolean;
  email_send_blocked?: boolean;
  email_send_draft?: EmailSendDraft;
};

export function parseEmailMessageMeta(
  metadata: unknown,
): ParsedEmailMessageMeta | null {
  let raw: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      raw = JSON.parse(metadata) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const draftRaw = m.email_send_draft;
  const draft =
    draftRaw && typeof draftRaw === "object"
      ? (draftRaw as EmailSendDraft)
      : undefined;
  return {
    email_send_pending: Boolean(m.email_send_pending),
    email_send_blocked: Boolean(m.email_send_blocked),
    email_send_draft: draft,
  };
}

/** Heurística alinhada ao Intelligence: evita envio automático com corpo bruto. */
export function emailBodyLooksRawOrIncomplete(body: string): boolean {
  const b = (body ?? "").trim().toLowerCase();
  if (b.length < 80) return true;
  const markers = [
    "resultados google",
    "resultados duckduckgo",
    "serpapi.com",
    "### motor:",
    "engine: google",
    "engine: duckduckgo",
  ];
  if (markers.some((m) => b.includes(m))) return true;
  const lines = (body ?? "")
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean);
  if (lines.length >= 3) {
    const urlLines = lines.filter((ln) => /^https?:\/\//i.test(ln)).length;
    if (urlLines >= 3 && b.length < 1200) return true;
  }
  const words = (b.match(/[a-záàâãéêíóôõúç]{3,}/gi) ?? []).length;
  const urls = ((body ?? "").match(/https?:\/\/[^\s)]+/gi) ?? []).length;
  if (urls >= 3 && words < 40) return true;
  return false;
}

export function emailBodyLooksReadyForAutosend(body: string): boolean {
  return !emailBodyLooksRawOrIncomplete(body);
}

export function buildEmailSendPayload(draft: EmailSendDraft): {
  to?: string;
  subject: string;
  body: string;
  contact_id?: string;
} {
  const cid = draft.contact_id?.trim();
  const to = draft.to?.trim();
  const subject = (draft.subject ?? "").trim();
  const body = (draft.body ?? "").trim();
  if (cid) {
    return { contact_id: cid, subject, body };
  }
  return { to: to ?? "", subject, body };
}
