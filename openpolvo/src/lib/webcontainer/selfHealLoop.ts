/**
 * Loop Self-Healing: WebContainer → erro de build → backend → patch → retry.
 */

import { pickVirtualFilesForHeal } from "@/lib/devStudio/collectProjectFilesForHeal";
import { previewConsoleLogsFromCompileLog } from "@/lib/devStudio/compileLogBuffer";
import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { requestDevStudioSelfHeal } from "@/lib/devStudioSelfHealApi";
import { getWebContainerPreviewService } from "@/lib/webcontainer";

const MAX_SELF_HEAL_ATTEMPTS = 3;

export type SelfHealLoopOptions = {
  ops: DevStudioOp[];
  npmInstall: boolean;
  userPrompt?: string;
};

export type SelfHealLoopResult = {
  url: string;
  healAttempts: number;
  lastHealSummary?: string;
};

export async function applyOpsInWebContainerWithSelfHeal(
  options: SelfHealLoopOptions,
): Promise<SelfHealLoopResult> {
  const svc = getWebContainerPreviewService();
  let pendingOps = [...options.ops];
  let healAttempts = 0;
  let lastHealSummary: string | undefined;

  for (let attempt = 0; attempt <= MAX_SELF_HEAL_ATTEMPTS; attempt++) {
    try {
      const url = await svc.runProject({
        ops: pendingOps,
        npmInstall: options.npmInstall && attempt === 0,
      });

      if (svc.hasCompileErrors()) {
        throw new Error(svc.getCompileLog() || "Erro de compilação no preview");
      }

      return { url, healAttempts, lastHealSummary };
    } catch (e) {
      const compileLog =
        svc.getCompileLog().trim() ||
        (e instanceof Error ? e.message : String(e));

      if (attempt >= MAX_SELF_HEAL_ATTEMPTS) {
        throw new Error(
          compileLog.slice(-1200) ||
            "Não foi possível corrigir o preview automaticamente.",
        );
      }

      const projectFiles = pickVirtualFilesForHeal(
        svc.getVirtualFiles(),
        compileLog,
      );
      const heal = await requestDevStudioSelfHeal({
        compile_log: compileLog,
        preview_console_logs: previewConsoleLogsFromCompileLog(compileLog),
        project_files: projectFiles,
        user_prompt: options.userPrompt,
      });

      if (!heal.heal_ops.length) {
        throw new Error(
          heal.assistant_text ||
            "Self-healing não produziu correcções para o erro de build.",
        );
      }

      pendingOps = heal.heal_ops;
      lastHealSummary = heal.assistant_text || undefined;
      healAttempts += 1;
    }
  }

  throw new Error("Self-healing esgotou tentativas.");
}
