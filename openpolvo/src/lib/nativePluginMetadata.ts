import type { AppId } from "@/config/apps";
import { isAppId } from "@/config/apps";
import type { MessageDTO } from "@/lib/conversationsApi";

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Se a última mensagem do assistente pedir um plugin nativo, abre no painel. */
export function tryOpenNativePluginFromMessages(
  messages: MessageDTO[],
  openPlugin: (id: AppId) => void,
): void {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last) return;
  const meta = parseMetadata(last.metadata);
  const np = meta?.native_plugin;
  if (!np || typeof np !== "object" || Array.isArray(np)) return;
  const id = (np as Record<string, unknown>).id;
  if (typeof id !== "string" || !isAppId(id)) return;
  openPlugin(id);
}
