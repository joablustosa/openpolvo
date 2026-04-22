import { apiUrl } from "./api";

export type SocialConfigDTO = {
  id: string;
  platforms: string[];
  sites: string[];
  times_per_day: number;
  approval_phone: string;
  active: boolean;
  last_run_at?: string;
};

export type SocialPostDTO = {
  id: string;
  user_id: string;
  platform: string;
  title: string;
  description: string;
  hashtags: string[];
  image_url: string;
  image_prompt: string;
  source_url: string;
  source_title: string;
  status: "generating" | "pending_approval" | "approved" | "rejected" | "published" | "failed";
  published_post_id: string;
  failure_reason: string;
  created_at: string;
  updated_at: string;
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

export async function getSocialConfig(token: string): Promise<SocialConfigDTO | null> {
  const res = await fetch(apiUrl("/v1/social/config"), { headers: headersJson(token) });
  if (!res.ok) throw new Error(await readApiError(res, `social config get: ${res.status}`));
  return res.json() as Promise<SocialConfigDTO | null>;
}

export async function putSocialConfig(
  token: string,
  body: {
    platforms: string[];
    sites: string[];
    times_per_day: number;
    approval_phone: string;
    active: boolean;
  },
): Promise<void> {
  const res = await fetch(apiUrl("/v1/social/config"), {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, `social config put: ${res.status}`));
}

export async function generateSocialNow(token: string): Promise<{ generated: number }> {
  const res = await fetch(apiUrl("/v1/social/generate"), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(await readApiError(res, `social generate: ${res.status}`));
  return res.json() as Promise<{ generated: number }>;
}

export async function getSocialPosts(token: string): Promise<SocialPostDTO[]> {
  const res = await fetch(apiUrl("/v1/social/posts"), { headers: headersJson(token) });
  if (!res.ok) throw new Error(await readApiError(res, `social posts: ${res.status}`));
  return res.json() as Promise<SocialPostDTO[]>;
}

export async function approvePost(token: string, id: string): Promise<void> {
  const res = await fetch(apiUrl(`/v1/social/posts/${id}/approve`), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(await readApiError(res, `approve post: ${res.status}`));
}

export async function rejectPost(token: string, id: string): Promise<void> {
  const res = await fetch(apiUrl(`/v1/social/posts/${id}/reject`), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(await readApiError(res, `reject post: ${res.status}`));
}
