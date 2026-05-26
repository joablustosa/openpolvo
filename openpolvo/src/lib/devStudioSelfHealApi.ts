import { fetchApi } from "@/lib/api";
import { ApiError } from "@/lib/apiErrors";
import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { parseDevStudioMessageMeta } from "@/lib/devStudioMetadata";

export type DevStudioSelfHealRequest = {
  compile_log: string;
  preview_console_logs?: Array<{ level: string; message: string; source?: string }>;
  project_files: Record<string, string>;
  user_prompt?: string;
  model_provider?: "openai" | "google";
};

export type DevStudioSelfHealResult = {
  assistant_text: string;
  metadata: Record<string, unknown>;
  heal_ops: DevStudioOp[];
};

function authToken(): string | null {
  try {
    return localStorage.getItem("smartagent_auth_token");
  } catch {
    return null;
  }
}

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/** Chama o backend (proxy → Intelligence) para corrigir erros de build com patches mínimos. */
export async function requestDevStudioSelfHeal(
  body: DevStudioSelfHealRequest,
): Promise<DevStudioSelfHealResult> {
  const token = authToken();
  if (!token) {
    throw new ApiError(401, "Sessão expirada — inicia sessão para corrigir o preview.");
  }

  const res = await fetchApi("/v1/dev-studio/self-heal", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({
      model_provider: body.model_provider ?? "openai",
      user_prompt: body.user_prompt ?? "",
      compile_log: body.compile_log,
      preview_console_logs: body.preview_console_logs,
      project_files: body.project_files,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg =
      (err as { error?: string }).error?.trim() ||
      `Self-heal falhou (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  const data = (await res.json()) as {
    assistant_text?: string;
    metadata?: Record<string, unknown>;
  };
  const meta = data.metadata ?? {};
  const parsed = parseDevStudioMessageMeta(meta);
  const heal_ops = parsed?.polvo_code_ops ?? [];

  return {
    assistant_text: String(data.assistant_text ?? "").trim(),
    metadata: meta,
    heal_ops,
  };
}
