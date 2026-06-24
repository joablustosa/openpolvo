import type { DeskModelProvider } from "@/lib/deskContext";

export type DeskConversationPrefs = {
  workspacePath: string | null;
  modelProvider: DeskModelProvider;
  updatedAt: string;
};

const STORAGE_KEY = "openpolvo_desk_conversation_prefs";

function readMap(): Record<string, DeskConversationPrefs> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, DeskConversationPrefs>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, DeskConversationPrefs>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function getDeskConversationPrefs(conversationId: string): DeskConversationPrefs | null {
  const id = conversationId.trim();
  if (!id) return null;
  const row = readMap()[id];
  if (!row) return null;
  return {
    workspacePath: row.workspacePath?.trim() || null,
    modelProvider: row.modelProvider ?? "ollama",
    updatedAt: row.updatedAt,
  };
}

export function saveDeskConversationPrefs(
  conversationId: string,
  patch: Partial<Pick<DeskConversationPrefs, "workspacePath" | "modelProvider">>,
): void {
  const id = conversationId.trim();
  if (!id) return;
  const map = readMap();
  const prev = map[id];
  map[id] = {
    workspacePath:
      patch.workspacePath !== undefined
        ? patch.workspacePath?.trim() || null
        : (prev?.workspacePath ?? null),
    modelProvider: patch.modelProvider ?? prev?.modelProvider ?? "ollama",
    updatedAt: new Date().toISOString(),
  };
  writeMap(map);
}
