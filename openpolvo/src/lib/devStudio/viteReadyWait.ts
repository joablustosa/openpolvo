import {
  devStudioHasCompileErrors,
} from "@/lib/devStudio/compileLogBuffer";
import { getLastDevStudioUrl } from "@/lib/devStudioPreviewBus";

const POLL_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

export type ViteCompileWaitResult = "ok" | "error" | "timeout";

/**
 * Espera o Vite reportar URL ou erro — sai cedo quando possível (evita sleep fixo de 4–5s).
 */
export async function waitForViteCompileResult(options: {
  maxMs: number;
  /** Após ver URL, quanto tempo sem novos erros antes de considerar OK. */
  stableOkMs: number;
}): Promise<ViteCompileWaitResult> {
  const deadline = Date.now() + options.maxMs;
  let urlStableSince = 0;

  while (Date.now() < deadline) {
    if (devStudioHasCompileErrors()) {
      return "error";
    }

    const url = getLastDevStudioUrl();
    if (url) {
      if (!urlStableSince) {
        urlStableSince = Date.now();
      } else if (Date.now() - urlStableSince >= options.stableOkMs) {
        return "ok";
      }
    } else {
      urlStableSince = 0;
    }

    await sleep(POLL_MS);
  }

  if (devStudioHasCompileErrors()) return "error";
  if (getLastDevStudioUrl()) return "ok";
  return "timeout";
}
