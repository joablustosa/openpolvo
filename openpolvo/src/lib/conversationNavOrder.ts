import type { ConversationDTO } from "@/lib/conversationsApi";

function timeMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Separa conversas fixadas (no topo, mais recentemente fixadas primeiro) e recentes
 * (por updated_at descendente), alinhado ao ORDER BY da API.
 */
export function partitionConversationsForNav(
  conversations: ConversationDTO[],
): { pinned: ConversationDTO[]; recent: ConversationDTO[] } {
  const pinned = conversations
    .filter((c) => Boolean(c.pinned_at))
    .sort((a, b) => timeMs(b.pinned_at) - timeMs(a.pinned_at));

  const recent = conversations
    .filter((c) => !c.pinned_at)
    .sort((a, b) => timeMs(b.updated_at) - timeMs(a.updated_at));

  return { pinned, recent };
}
