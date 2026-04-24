import type { ModelProvider } from "./conversationsApi";
import type { LlmProfileDTO } from "./llmProfilesApi";

/** Valor do select: automático, fornecedor directo, ou `p:<uuid>` para perfil da BD. */
export type LlmRoutingSelect = string;

export function parseLlmRoutingSelect(v: string): {
  model: ModelProvider;
  profileId: string | null;
} {
  const s = v.trim();
  if (s.startsWith("p:")) {
    const id = s.slice(2).trim();
    if (id) return { model: "auto", profileId: id };
  }
  if (s === "openai" || s === "google" || s === "auto") {
    return { model: s, profileId: null };
  }
  return { model: "auto", profileId: null };
}

/** Modelo gravado na conversa ao criar (perfil explícito → auto no servidor). */
export function defaultModelForNewConversation(select: string): ModelProvider {
  const { model, profileId } = parseLlmRoutingSelect(select);
  if (profileId) return "auto";
  return model;
}

/** Whisper / Gemini multimodal: precisa de um fornecedor concreto. */
export function transcribeModelProvider(
  select: string,
  profiles: Pick<LlmProfileDTO, "id" | "provider" | "has_api_key">[],
): "openai" | "google" {
  const { profileId } = parseLlmRoutingSelect(select);
  if (profileId) {
    const p = profiles.find((x) => x.id === profileId && x.has_api_key);
    if (p?.provider === "google") return "google";
    return "openai";
  }
  const { model } = parseLlmRoutingSelect(select);
  if (model === "google") return "google";
  return "openai";
}
