/**
 * Monitoriza erros no log do preview e dispara self-heal automático (agente + apply no disco).
 */

import {
  dispatchDevStudioApplyEnd,
  dispatchDevStudioApplyStart,
} from "@/lib/devStudioApplyEvents";
import {
  appendDevStudioCompileLog,
  clearDevStudioCompileLog,
  devStudioHasPreviewErrors,
  getDevStudioCompileLog,
  previewConsoleLogsFromCompileLog,
} from "@/lib/devStudio/compileLogBuffer";
import { detectPreviewErrors } from "@/lib/devStudio/previewErrorDetect";
import { requestDevStudioSelfHeal } from "@/lib/devStudioSelfHealApi";
import { isElectron } from "@/lib/desktopApi";
import {
  applyOpsInWebContainerWithSelfHeal,
  getWebContainerPreviewService,
  isWebContainerWorkspace,
} from "@/lib/webcontainer";

const DEBOUNCE_MS = 2_000;
const COOLDOWN_MS = 12_000;
const MAX_AUTO_HEALS_PER_SESSION = 8;

const AUTO_USER_PROMPT =
  "Corrigir automaticamente os erros detectados na consola do preview (runtime ou build). Aplicar patches mínimos no código.";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let healInFlight = false;
let lastHealAt = 0;
let healCount = 0;
let lastSignature = "";

function logSignature(getLog: () => string): string {
  const log = getLog();
  const lines = log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && detectPreviewErrors(l));
  return lines.slice(-4).join("|");
}

export function appendPreviewConsoleMessage(
  level: number,
  message: string,
  sourceId: string,
  line: number,
): void {
  const lvl =
    level >= 3 ? "error" : level === 2 ? "warn" : level === 1 ? "info" : "log";
  const src = sourceId ? `${sourceId}:${line}` : "";
  const row = `[console:${lvl}] ${message}${src ? ` (${src})` : ""}`;
  appendDevStudioCompileLog(row);
}

export function schedulePreviewAutoHeal(
  workspacePath: string,
  getLog: () => string = getDevStudioCompileLog,
): void {
  const wp = workspacePath.trim();
  if (!wp || healInFlight) return;
  if (!devStudioHasPreviewErrors()) return;

  const sig = logSignature(getLog);
  if (!sig || sig === lastSignature) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runPreviewErrorAutoHeal(wp, getLog);
  }, DEBOUNCE_MS);
}

export async function runPreviewErrorAutoHeal(
  workspacePath: string,
  getLog: () => string = getDevStudioCompileLog,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const wp = workspacePath.trim();
  if (!wp || healInFlight) return { ok: false };
  if (!devStudioHasPreviewErrors()) return { ok: false };

  const now = Date.now();
  if (now - lastHealAt < COOLDOWN_MS) return { ok: false };
  if (healCount >= MAX_AUTO_HEALS_PER_SESSION) {
    return { ok: false, error: "Limite de correcções automáticas atingido nesta sessão." };
  }

  const sig = logSignature(getLog);
  if (sig === lastSignature) return { ok: false };

  healInFlight = true;
  lastSignature = sig;
  dispatchDevStudioApplyStart();

  try {
    const compileLog = getLog().trim().slice(-12_000);
    if (isWebContainerWorkspace(wp)) {
      const result = await runWebContainerAutoHeal(compileLog);
      if (result.ok) {
        lastHealAt = Date.now();
        healCount += 1;
      }
      return result;
    }

    if (!isElectron()) {
      return { ok: false, error: "Auto-heal requer Electron ou WebContainer." };
    }

    const { applyOpsInElectronWithSelfHeal } = await import(
      "@/lib/devStudio/electronSelfHealLoop",
    );

    const result = await applyOpsInElectronWithSelfHeal({
      workspacePath: wp,
      ops: [],
      runInstall: false,
      userPrompt: AUTO_USER_PROMPT,
    });

    clearDevStudioCompileLog();
    lastHealAt = Date.now();
    healCount += 1;
    const summary =
      result.lastHealSummary ||
      (result.healAttempts
        ? `Preview corrigido automaticamente (${result.healAttempts}×).`
        : "Preview actualizado após detecção de erro na consola.");
    dispatchDevStudioApplyEnd(true);
    return { ok: true, summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha na correcção automática";
    dispatchDevStudioApplyEnd(false, msg);
    return { ok: false, error: msg };
  } finally {
    healInFlight = false;
  }
}

async function runWebContainerAutoHeal(
  compileLog: string,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const svc = getWebContainerPreviewService();
  const heal = await requestDevStudioSelfHeal({
    compile_log: compileLog,
    preview_console_logs: previewConsoleLogsFromCompileLog(compileLog),
    project_files: svc.getVirtualFiles(),
    user_prompt: AUTO_USER_PROMPT,
  });
  if (!heal.heal_ops.length) {
    dispatchDevStudioApplyEnd(false);
    return { ok: false, error: heal.assistant_text || "Sem correcções geradas." };
  }
  await applyOpsInWebContainerWithSelfHeal({
    ops: heal.heal_ops,
    npmInstall: false,
    userPrompt: AUTO_USER_PROMPT,
  });
  clearDevStudioCompileLog();
  dispatchDevStudioApplyEnd(true);
  return { ok: true, summary: heal.assistant_text || "Preview corrigido (WebContainer)." };
}

export function resetPreviewAutoHealSession(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  healInFlight = false;
  lastHealAt = 0;
  healCount = 0;
  lastSignature = "";
}
