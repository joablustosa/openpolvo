import type { ModelProvider } from "./conversationsApi";
import type { LlmProfileDTO } from "./llmProfilesApi";
import type { DeskModelProvider } from "./deskContext";

/** Valor do select: automático, fornecedor directo, Ollama, ou `p:<uuid>` para perfil da BD. */
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
  if (s === "openai" || s === "google" || s === "ollama" || s === "auto") {
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

/** Mapeia select do chat → `desk_context.model_provider`. */
export function llmSelectToDeskModelProvider(select: string): DeskModelProvider {
  const { model, profileId } = parseLlmRoutingSelect(select);
  if (model === "ollama") return "ollama";
  if (profileId) return "auto";
  if (model === "openai" || model === "google") return model;
  return "auto";
}

/** Restaura select a partir de prefs Desk legadas ou modelo da conversa. */
export function llmSelectFromStored(
  stored: string | null | undefined,
  fallbackModel?: ModelProvider | string | null,
): string {
  const s = (stored ?? "").trim();
  if (s) return s;
  const fb = (fallbackModel ?? "").trim();
  if (fb === "openai" || fb === "google" || fb === "ollama" || fb === "auto") return fb;
  return "auto";
}

export function formatLlmSelectLabel(
  select: string,
  profiles: Pick<LlmProfileDTO, "id" | "display_name" | "provider" | "model_id" | "has_api_key">[],
): string {
  const s = select.trim();
  if (s === "auto") return "Automático";
  if (s === "ollama") return "Ollama (local)";
  if (s === "openai") return "OpenAI (sem perfil)";
  if (s === "google") return "Gemini (sem perfil)";
  if (s.startsWith("p:")) {
    const id = s.slice(2).trim();
    const p = profiles.find((x) => x.id === id);
    if (p) {
      const vendor = p.provider === "google" ? "Gemini" : "OpenAI";
      return `${p.display_name} · ${p.model_id} (${vendor})`;
    }
    return "Perfil LLM";
  }
  return "Modelo";
}
