import { fetchApi } from "./api";
import { ApiError } from "./apiErrors";

async function ensureOk(res: Response, fallbackLabel: string): Promise<void> {
  if (res.ok) return;
  const err = await res.json().catch(() => ({}));
  const parsed = (err as { error?: string }).error?.trim();
  const msg =
    parsed && parsed.length > 0 ? parsed : `${fallbackLabel} (${res.status})`;
  throw new ApiError(res.status, msg);
}

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export type LlmProfileDTO = {
  id: string;
  display_name: string;
  provider: "openai" | "google";
  model_id: string;
  sort_order: number;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
};

export type LlmAgentPrefsDTO = {
  agent_mode: "auto" | "profile";
  default_profile_id?: string | null;
  updated_at: string;
};

export async function fetchLlmProfiles(token: string): Promise<LlmProfileDTO[]> {
  const res = await fetchApi("/v1/llm/profiles", {
    headers: headersJson(token),
  });
  await ensureOk(res, "perfis LLM");
  return res.json() as Promise<LlmProfileDTO[]>;
}

export async function createLlmProfile(
  token: string,
  body: {
    display_name: string;
    provider: "openai" | "google";
    model_id: string;
    api_key: string;
    sort_order?: number;
  },
): Promise<LlmProfileDTO> {
  const res = await fetchApi("/v1/llm/profiles", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  await ensureOk(res, "criar perfil LLM");
  return res.json() as Promise<LlmProfileDTO>;
}

export async function patchLlmProfile(
  token: string,
  id: string,
  body: {
    display_name?: string;
    model_id?: string;
    api_key?: string;
    sort_order?: number;
  },
): Promise<LlmProfileDTO> {
  const res = await fetchApi(`/v1/llm/profiles/${id}`, {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  await ensureOk(res, "actualizar perfil LLM");
  return res.json() as Promise<LlmProfileDTO>;
}

export async function deleteLlmProfile(token: string, id: string): Promise<void> {
  const res = await fetchApi(`/v1/llm/profiles/${id}`, {
    method: "DELETE",
    headers: headersJson(token),
  });
  await ensureOk(res, "eliminar perfil LLM");
}

export async function getLlmAgentPrefs(token: string): Promise<LlmAgentPrefsDTO> {
  const res = await fetchApi("/v1/llm/agent-prefs", {
    headers: headersJson(token),
  });
  await ensureOk(res, "preferências do agente LLM");
  return res.json() as Promise<LlmAgentPrefsDTO>;
}

export async function putLlmAgentPrefs(
  token: string,
  body: { agent_mode: "auto" | "profile"; default_profile_id?: string | null },
): Promise<LlmAgentPrefsDTO> {
  const res = await fetchApi("/v1/llm/agent-prefs", {
    method: "PUT",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  await ensureOk(res, "guardar preferências do agente LLM");
  return res.json() as Promise<LlmAgentPrefsDTO>;
}
