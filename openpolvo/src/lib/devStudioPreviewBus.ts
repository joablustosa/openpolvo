import { appendDevStudioCompileLog } from "@/lib/devStudio/compileLogBuffer";
import { desktopPolvoCode, isElectron, type PolvoCodeEvent } from "@/lib/desktopApi";

type Listener = (ev: PolvoCodeEvent) => void;

let installed = false;
let lastDevUrl = "";
const listeners = new Set<Listener>();

/** Regista listener global de eventos Vite/npm (não perder URL se o painel ainda não montou). */
export function installDevStudioPreviewBus(): () => void {
  if (!isElectron() || installed) return () => {};
  installed = true;
  return desktopPolvoCode.onEvent((ev) => {
    if (ev.type === "log") {
      appendDevStudioCompileLog(ev.line);
    }
    if (ev.type === "url" && ev.url) {
      lastDevUrl = ev.url;
    }
    for (const fn of listeners) fn(ev);
  });
}

export function subscribeDevStudioPreview(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLastDevStudioUrl(): string {
  return lastDevUrl;
}

export function clearLastDevStudioUrl(): void {
  lastDevUrl = "";
}
