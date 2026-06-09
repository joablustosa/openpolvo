/**
 * Ponte do console da iframe de preview (WebContainer) → buffer de logs do host.
 *
 * A app de preview corre numa origem diferente (URL do WebContainer), pelo que não
 * conseguimos ler a sua consola directamente. O scaffold injecta um pequeno relay
 * (ver `buildPreviewConsoleRelaySnippet`) que reenvia erros via `postMessage`.
 * Aqui escutamos essas mensagens, alimentamos o `compileLogBuffer` e agendamos
 * auto-heal — garantindo que os erros de runtime são enviados ao backend no turno
 * seguinte (via `collectDevStudioChatPayload`).
 */

import {
  appendPreviewConsoleMessage,
  schedulePreviewAutoHeal,
} from "@/lib/devStudio/previewAutoHeal";
import { PREVIEW_CONSOLE_BRIDGE_SOURCE } from "@/lib/devStudio/previewConsoleRelay";

type PreviewConsoleMessage = {
  source: typeof PREVIEW_CONSOLE_BRIDGE_SOURCE;
  level: number;
  message: string;
  sourceId?: string;
  line?: number;
};

function parseBridgeMessage(data: unknown): PreviewConsoleMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== PREVIEW_CONSOLE_BRIDGE_SOURCE) return null;
  const message = typeof d.message === "string" ? d.message : "";
  if (!message.trim()) return null;
  const level = typeof d.level === "number" ? d.level : 3;
  return {
    source: PREVIEW_CONSOLE_BRIDGE_SOURCE,
    level,
    message,
    sourceId: typeof d.sourceId === "string" ? d.sourceId : undefined,
    line: typeof d.line === "number" ? d.line : undefined,
  };
}

/**
 * Liga o relay da iframe ao host. `getWorkspacePath` resolve o projecto activo
 * no momento de cada erro (a conversa pode ter mudado). Devolve cleanup.
 */
export function installPreviewConsoleBridge(
  getWorkspacePath: () => string,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onMessage = (event: MessageEvent): void => {
    const parsed = parseBridgeMessage(event.data);
    if (!parsed) return;
    appendPreviewConsoleMessage(
      parsed.level,
      parsed.message,
      parsed.sourceId ?? "",
      parsed.line ?? 0,
    );
    const wp = getWorkspacePath().trim();
    if (wp) schedulePreviewAutoHeal(wp);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
