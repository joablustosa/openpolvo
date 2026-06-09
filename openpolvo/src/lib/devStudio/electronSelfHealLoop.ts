/**
 * Self-healing no Electron: aplica ops → npm run dev → detecta erro Vite → Intelligence → retry.
 * Optimizado: espera adaptativa, HMR sem restart quando só .tsx, leitura mínima de ficheiros.
 */

import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { requestDevStudioSelfHeal } from "@/lib/devStudioSelfHealApi";
import { collectProjectFilesForHeal } from "@/lib/devStudio/collectProjectFilesForHeal";
import {
  clearDevStudioCompileLog,
  devStudioHasCompileErrors,
  getDevStudioCompileLog,
  previewConsoleLogsFromCompileLog,
} from "@/lib/devStudio/compileLogBuffer";
import { waitForViteCompileResult } from "@/lib/devStudio/viteReadyWait";
import { desktopPolvoCode } from "@/lib/desktopApi";
import { DEV_STUDIO_PREVIEW_PORT } from "@/modules/dev-studio/config";
import { buildLayoutScaffoldHealOps } from "@/lib/devStudio/layoutScaffoldHeal";
import { buildMissingImportHealOps } from "@/lib/devStudio/missingImportHeal";
import { buildUndefinedSymbolHealOps } from "@/lib/devStudio/undefinedSymbolHeal";
import { sanitizeDevStudioOps } from "@/lib/devStudio/sanitizePreviewSource";
import type { DesignTokens } from "@/lib/webcontainer/shadcnScaffold";

const MAX_SELF_HEAL_ATTEMPTS = 3;
const WAIT_FIRST_BOOT_MS = 90_000;
const WAIT_HEAL_MS = 20_000;
const STABLE_OK_MS = 500;

export type ElectronSelfHealOptions = {
  workspacePath: string;
  ops: DevStudioOp[];
  runInstall: boolean;
  userPrompt?: string;
  designTokens?: Partial<DesignTokens>;
  /** Conversa ativa: chaveia o RAG de memória de erros por projeto no Intelligence. */
  conversationId?: string;
  bootstrapNewProject?: {
    title: string;
    files: { path: string; content: string }[];
  };
};

export type ElectronSelfHealResult = {
  workspacePath: string;
  healAttempts: number;
  lastHealSummary?: string;
};

function touchesPackageJson(ops: DevStudioOp[]): boolean {
  return ops.some(
    (o) =>
      o.op === "write" &&
      (o.path === "package.json" || o.path.endsWith("/package.json")),
  );
}

/** Correcção imediata sem LLM — layout scaffold (Navbar, AppShell, Sidebar). */
function deterministicHealOps(
  compileLog: string,
  designTokens?: Partial<DesignTokens>,
  projectFiles?: Record<string, string>,
): DevStudioOp[] | null {
  return (
    buildLayoutScaffoldHealOps(compileLog, designTokens) ||
    buildMissingImportHealOps(compileLog) ||
    buildUndefinedSymbolHealOps(compileLog, projectFiles)
  );
}

function canUseHotReload(ops: DevStudioOp[]): boolean {
  if (!ops.length) return false;
  return ops.every(
    (o) =>
      o.op === "mkdir" ||
      (o.op === "write" &&
        /\.(tsx?|jsx?|css)$/.test(o.path) &&
        !o.path.endsWith("package.json")),
  );
}

async function applyOpsToWorkspace(
  workspacePath: string,
  ops: DevStudioOp[],
): Promise<string | undefined> {
  for (const o of ops) {
    if (o.op === "mkdir") {
      const mr = await desktopPolvoCode.mkdir({
        workspacePath,
        relPath: o.path,
      });
      if (!mr.ok) return mr.error ?? `mkdir ${o.path}`;
    }
  }
  for (const o of ops) {
    if (o.op === "write") {
      const wr = await desktopPolvoCode.writeFile({
        workspacePath,
        relPath: o.path,
        content: o.content ?? "",
        createDirs: true,
      });
      if (!wr.ok) return wr.error ?? `write ${o.path}`;
    }
  }
  return undefined;
}

async function restartDevServer(workspacePath: string): Promise<string | undefined> {
  await desktopPolvoCode.devStop();
  clearDevStudioCompileLog();
  const dr = await desktopPolvoCode.devStart({
    workspacePath,
    port: DEV_STUDIO_PREVIEW_PORT,
    openBrowser: false,
  });
  if (!dr.ok) return dr.error ?? "Falha ao iniciar o servidor de preview.";
  return undefined;
}

export async function applyOpsInElectronWithSelfHeal(
  options: ElectronSelfHealOptions,
): Promise<ElectronSelfHealResult> {
  let workspacePath = options.workspacePath.trim();
  if (!workspacePath && !options.bootstrapNewProject) {
    throw new Error("Caminho do projecto inválido.");
  }

  let pendingOps = sanitizeDevStudioOps([...options.ops]);
  let healAttempts = 0;
  let lastHealSummary: string | undefined;
  let runInstall = options.runInstall;
  const bootstrap = options.bootstrapNewProject;
  let devRunning = false;

  for (let attempt = 0; attempt <= MAX_SELF_HEAL_ATTEMPTS; attempt++) {
    if (bootstrap && attempt === 0 && bootstrap.files.length) {
      const wpRes = await desktopPolvoCode.writeProject({
        title: bootstrap.title,
        files: bootstrap.files,
      });
      if (!wpRes.ok) {
        throw new Error(wpRes.error ?? "Falha ao criar o projecto.");
      }
      if (!wpRes.workspacePath) {
        throw new Error("Falha ao criar o projecto.");
      }
      workspacePath = wpRes.workspacePath;
    } else if (pendingOps.length) {
      const err = await applyOpsToWorkspace(workspacePath, pendingOps);
      if (err) throw new Error(err);
    }

    if (runInstall) {
      const ir = await desktopPolvoCode.npmInstall(workspacePath);
      if (!ir.ok) throw new Error(ir.error ?? "npm install falhou.");
      runInstall = false;
    }

    const useHotReload =
      devRunning && pendingOps.length > 0 && canUseHotReload(pendingOps);

    if (!useHotReload) {
      const startErr = await restartDevServer(workspacePath);
      if (startErr) throw new Error(startErr);
      devRunning = true;
    } else {
      clearDevStudioCompileLog();
    }

    const waitResult = await waitForViteCompileResult({
      maxMs: attempt === 0 && !useHotReload ? WAIT_FIRST_BOOT_MS : WAIT_HEAL_MS,
      stableOkMs: STABLE_OK_MS,
    });

    if (waitResult === "ok" || (waitResult === "timeout" && !devStudioHasCompileErrors())) {
      return { workspacePath, healAttempts, lastHealSummary };
    }

    const compileLog = getDevStudioCompileLog().trim();
    if (attempt >= MAX_SELF_HEAL_ATTEMPTS) {
      throw new Error(
        compileLog.slice(-2000) ||
          "Não foi possível corrigir o preview automaticamente.",
      );
    }

    const projectFilesForHeal = await collectProjectFilesForHeal(
      workspacePath,
      compileLog,
    );
    const deterministic = deterministicHealOps(
      compileLog,
      options.designTokens,
      projectFilesForHeal,
    );
    if (deterministic?.length) {
      pendingOps = deterministic;
      lastHealSummary =
        "Layout scaffold restaurado (AppShell, Navbar, Sidebar).";
      healAttempts += 1;
      continue;
    }

    const heal = await requestDevStudioSelfHeal({
      compile_log: compileLog,
      preview_console_logs: previewConsoleLogsFromCompileLog(compileLog),
      project_files: projectFilesForHeal,
      user_prompt: options.userPrompt,
      conversation_id: options.conversationId,
    });

    if (!heal.heal_ops.length) {
      throw new Error(
        heal.assistant_text ||
          "Self-healing não produziu correcções para o erro de build.",
      );
    }

    pendingOps = sanitizeDevStudioOps(heal.heal_ops);
    lastHealSummary = heal.assistant_text || undefined;
    healAttempts += 1;
    if (touchesPackageJson(pendingOps)) {
      runInstall = true;
    }
  }

  throw new Error("Self-healing esgotou tentativas.");
}
