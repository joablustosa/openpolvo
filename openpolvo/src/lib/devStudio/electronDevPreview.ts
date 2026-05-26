/**
 * Arranque rápido do Vite no Electron (sem self-heal LLM).
 * Usado ao abrir/restaurar conversa; apply com ops usa electronSelfHealLoop.
 */

import { clearDevStudioCompileLog, devStudioHasCompileErrors } from "@/lib/devStudio/compileLogBuffer";
import { waitForViteCompileResult } from "@/lib/devStudio/viteReadyWait";
import {
  clearLastDevStudioUrl,
  getLastDevStudioUrl,
} from "@/lib/devStudioPreviewBus";
import { desktopPolvoCode } from "@/lib/desktopApi";
import { DEV_STUDIO_PREVIEW_PORT } from "@/modules/dev-studio/config";

const DEFAULT_MAX_WAIT_MS = 60_000;

export type EnsureElectronDevPreviewOptions = {
  maxWaitMs?: number;
};

/**
 * Inicia `npm run dev` e espera URL do Vite. Não aplica ops nem chama Intelligence.
 */
export async function ensureElectronDevPreview(
  workspacePath: string,
  options?: EnsureElectronDevPreviewOptions,
): Promise<string> {
  const root = workspacePath.trim();
  if (!root) {
    throw new Error("Caminho do projecto inválido.");
  }

  clearDevStudioCompileLog();
  clearLastDevStudioUrl();

  const dr = await desktopPolvoCode.devStart({
    workspacePath: root,
    port: DEV_STUDIO_PREVIEW_PORT,
    openBrowser: false,
  });
  if (!dr.ok) {
    throw new Error(dr.error ?? "Falha ao iniciar o servidor de preview.");
  }

  const maxMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  await waitForViteCompileResult({ maxMs, stableOkMs: 400 });

  const detected = getLastDevStudioUrl();
  const fallback = `http://127.0.0.1:${DEV_STUDIO_PREVIEW_PORT}/`;
  return detected || fallback;
}

export function devPreviewStatusAfterStart(): { hasCompileErrors: boolean } {
  return { hasCompileErrors: devStudioHasCompileErrors() };
}
