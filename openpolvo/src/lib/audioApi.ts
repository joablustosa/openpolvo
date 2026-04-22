import { apiUrl } from "./api";

const AUTH_TOKEN_STORAGE_KEY = "smartagent_auth_token";

/** Token efectivo: argumento ou, em último caso, `localStorage` (evita pedidos com token desactualizado). */
function resolveBearerToken(explicit: string | null | undefined): string {
  const fromArg =
    typeof explicit === "string" && explicit.trim().length > 0 ? explicit.trim() : "";
  if (fromArg) return fromArg;
  try {
    const fromStore = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() ?? "";
    if (fromStore) return fromStore;
  } catch {
    /* noop */
  }
  throw new Error("Sessão inválida; inicie sessão novamente.");
}

export async function transcribeAudio(
  token: string | null | undefined,
  audioBlob: Blob,
  modelProvider: string,
): Promise<string> {
  const bearer = resolveBearerToken(token);
  const form = new FormData();
  form.append("audio", audioBlob, "recording.webm");
  form.append("model_provider", modelProvider);

  const res = await fetch(apiUrl("/v1/audio/transcribe"), {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: form,
  });

  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
  return data.text ?? "";
}
