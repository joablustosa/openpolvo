import type { DesignTokens } from "@/lib/webcontainer/shadcnScaffold";
import {
  ensureRunnableViteProject,
  mergedFilesToWriteOps,
} from "@/lib/webcontainer/opsToFileTree";
import { collectElectronProjectFilesForApply } from "@/lib/devStudio/collectElectronProjectFilesForApply";
import { desktopPolvoCode } from "@/lib/desktopApi";

/** Reconstrói App.tsx/rotas e corrige projectos antigos com scaffold placeholder. */
export async function repairDevStudioProjectOnDisk(
  workspacePath: string,
  designTokens?: Partial<DesignTokens>,
): Promise<{ repaired: boolean; filesWritten: number }> {
  const wp = workspacePath.trim();
  if (!wp) return { repaired: false, filesWritten: 0 };

  const current = await collectElectronProjectFilesForApply(wp);
  if (!Object.keys(current).length) return { repaired: false, filesWritten: 0 };

  const merged = ensureRunnableViteProject(current, designTokens);
  const ops = mergedFilesToWriteOps(current, merged);
  if (!ops.length) return { repaired: false, filesWritten: 0 };

  for (const o of ops) {
    if (o.op !== "write") continue;
    const wr = await desktopPolvoCode.writeFile({
      workspacePath: wp,
      relPath: o.path,
      content: o.content ?? "",
      createDirs: true,
    });
    if (!wr.ok) {
      throw new Error(wr.error ?? `Falha ao reparar ${o.path}`);
    }
  }

  return { repaired: true, filesWritten: ops.length };
}
