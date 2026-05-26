/**
 * Liga conversa ↔ projecto Dev Studio no disco (Electron).
 * A metadata da 1.ª resposta pode vir sem `project_id` — o caminho só existe após apply no cliente.
 */

export type DevStudioConversationProject = {
  workspacePath: string;
  title: string | null;
  updatedAt: string;
};

const STORAGE_KEY = "openpolvo_dev_studio_conversation_projects";

function readMap(): Record<string, DevStudioConversationProject> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, DevStudioConversationProject>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, DevStudioConversationProject>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / privado */
  }
}

export function saveDevStudioConversationProject(
  conversationId: string,
  workspacePath: string,
  title?: string | null,
): void {
  const id = conversationId.trim();
  const wp = workspacePath.trim();
  if (!id || !wp) return;
  const map = readMap();
  map[id] = {
    workspacePath: wp,
    title: title?.trim() || null,
    updatedAt: new Date().toISOString(),
  };
  writeMap(map);
}

export function getDevStudioConversationProject(
  conversationId: string,
): DevStudioConversationProject | null {
  const id = conversationId.trim();
  if (!id) return null;
  const row = readMap()[id];
  if (!row?.workspacePath?.trim()) return null;
  return {
    workspacePath: row.workspacePath.trim(),
    title: row.title?.trim() || null,
    updatedAt: row.updatedAt,
  };
}

export function removeDevStudioConversationProject(conversationId: string): void {
  const id = conversationId.trim();
  if (!id) return;
  const map = readMap();
  if (!map[id]) return;
  delete map[id];
  writeMap(map);
}
