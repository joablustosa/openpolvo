import type { DeskMode } from "@/desk/types";

export type DeskModelProvider = "ollama" | "openai" | "anthropic" | "google" | "auto";

export type DeskContextPayload = {
  mode: "agent" | "code";
  workspace_path: string;
  conversation_id: string;
  model_provider?: DeskModelProvider;
};

export function deskModeToContextMode(mode: DeskMode): "agent" | "code" {
  return mode === "code" ? "code" : "agent";
}

export function buildDeskContextPayload(input: {
  deskMode: DeskMode;
  workspacePath: string | null;
  conversationId: string;
  modelProvider: DeskModelProvider;
}): DeskContextPayload {
  return {
    mode: deskModeToContextMode(input.deskMode),
    workspace_path: input.workspacePath?.trim() ?? "",
    conversation_id: input.conversationId,
    model_provider: input.modelProvider,
  };
}
