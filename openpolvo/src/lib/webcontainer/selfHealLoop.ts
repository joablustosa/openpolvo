/**
 * Loop Self-Healing: WebContainer → erro de build → backend → patch → retry.
 */

import { pickVirtualFilesForHeal } from "@/lib/devStudio/collectProjectFilesForHeal";
import { previewConsoleLogsFromCompileLog } from "@/lib/devStudio/compileLogBuffer";
import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { requestDevStudioSelfHeal } from "@/lib/devStudioSelfHealApi";
import { getWebContainerPreviewService } from "@/lib/webcontainer";
import {
  mergeProjectWithOps,
  mergedFilesToWriteOps,
} from "@/lib/webcontainer/opsToFileTree";
import type { DesignTokens } from "@/lib/webcontainer/shadcnScaffold";

const MAX_SELF_HEAL_ATTEMPTS = 3;

export type SelfHealLoopOptions = {
  ops: DevStudioOp[];
  npmInstall: boolean;
  userPrompt?: string;
  designTokens?: Partial<DesignTokens>;
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
  const base = svc.getVirtualFiles();
  const merged = mergeProjectWithOps(base, options.ops, options.designTokens);
  let pendingOps = mergedFilesToWriteOps(base, merged);
  let healAttempts = 0;
  let lastHealSummary: string | undefined;

  for (let attempt = 0; attempt <= MAX_SELF_HEAL_ATTEMPTS; attempt++) {
    try {
      const url = await svc.runProject({
        ops: pendingOps,
        npmInstall: options.npmInstall && attempt === 0,
        designTokens: options.designTokens,
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
        conversation_id: svc.getConversationId() || undefined,
      });

      if (!heal.heal_ops.length) {
        throw new Error(
          heal.assistant_text ||
            "Self-healing não produziu correcções para o erro de build.",
        );
      }

      const healBase = svc.getVirtualFiles();
      const healMerged = mergeProjectWithOps(
        healBase,
        heal.heal_ops,
        options.designTokens,
      );
      pendingOps = mergedFilesToWriteOps(healBase, healMerged);
      lastHealSummary = heal.assistant_text || undefined;
      healAttempts += 1;
    }
  }

  throw new Error("Self-healing esgotou tentativas.");
}
