import { apiUrl } from "./api";

export type MetaSettingsDTO = {
  app_id: string;
  app_secret_set: boolean;
  wa_phone_number_id: string;
  wa_token_set: boolean;
  fb_page_id: string;
  fb_page_token_set: boolean;
  ig_account_id: string;
  ig_token_set: boolean;
  webhook_verify_token: string;
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
  } catch { /* not JSON */ }
  return t.length > 280 ? `${t.slice(0, 280)}…` : t;
}

export async function getMetaSettings(token: string): Promise<MetaSettingsDTO> {
  const res = await fetch(apiUrl("/v1/me/meta"), { headers: headersJson(token) });
  if (!res.ok) throw new Error(await readApiError(res, `meta get: ${res.status}`));
  return res.json() as Promise<MetaSettingsDTO>;
}

export async function putMetaSettings(
  token: string,
  body: {
    app_id?: string;
    app_secret?: string;
    wa_phone_number_id?: string;
    wa_access_token?: string;
    fb_page_id?: string;
    fb_page_token?: string;
    ig_account_id?: string;
    ig_access_token?: string;
    webhook_verify_token?: string;
  },
): Promise<void> {
  const res = await fetch(apiUrl("/v1/me/meta"), {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, `meta put: ${res.status}`));
}

export async function testMetaConnection(token: string): Promise<void> {
  const res = await fetch(apiUrl("/v1/me/meta/test"), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(await readApiError(res, `meta test: ${res.status}`));
}

export async function postMetaContent(
  token: string,
  body: { platform: "facebook" | "instagram"; message: string; image_url?: string },
): Promise<{ post_id: string }> {
  const res = await fetch(apiUrl("/v1/meta/content"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, `meta content: ${res.status}`));
  return res.json() as Promise<{ post_id: string }>;
}

export async function sendMetaMessage(
  token: string,
  body: { platform: "whatsapp"; to: string; text: string },
): Promise<{ message_id: string }> {
  const res = await fetch(apiUrl("/v1/meta/message"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, `meta message: ${res.status}`));
  return res.json() as Promise<{ message_id: string }>;
}
