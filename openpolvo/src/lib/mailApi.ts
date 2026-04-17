import { apiUrl } from "./api";

export type SmtpSettingsDTO = {
  host: string;
  port: number;
  username: string;
  password_set: boolean;
  from_email: string;
  from_name: string;
  use_tls: boolean;
  /** true = enviar pelo chat sem diálogo de confirmação */
  email_chat_skip_confirmation?: boolean;
  updated_at?: string;
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const t = await res.text();
  if (!t) return fallback;
  try {
    const j = JSON.parse(t) as { error?: string; message?: string };
    if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
    if (typeof j.message === "string" && j.message.trim()) return j.message.trim();
  } catch {
    /* not JSON */
  }
  return t.length > 280 ? `${t.slice(0, 280)}…` : t;
}

export async function getSmtpSettings(token: string): Promise<SmtpSettingsDTO> {
  const res = await fetch(apiUrl("/v1/me/smtp"), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(await readApiError(res, `smtp get: ${res.status}`));
  return res.json() as Promise<SmtpSettingsDTO>;
}

export async function putSmtpSettings(
  token: string,
  body: {
    host: string;
    port: number;
    username: string;
    password?: string;
    from_email: string;
    from_name: string;
    use_tls: boolean;
    email_chat_skip_confirmation?: boolean;
  },
): Promise<void> {
  const res = await fetch(apiUrl("/v1/me/smtp"), {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `smtp put: ${res.status}`));
  }
}

export async function sendEmail(
  token: string,
  body: { to?: string; subject: string; body: string; contact_id?: string },
): Promise<void> {
  const res = await fetch(apiUrl("/v1/email/send"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `email send: ${res.status}`));
  }
}

export async function testSmtpConnection(token: string): Promise<void> {
  const res = await fetch(apiUrl("/v1/me/smtp/test"), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `smtp test: ${res.status}`));
  }
}
