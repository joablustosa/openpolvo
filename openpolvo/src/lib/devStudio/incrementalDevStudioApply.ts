import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { desktopPolvoCode, isElectron } from "@/lib/desktopApi";
import { getWebContainerPreviewService } from "@/lib/webcontainer";

export type IncrementalApplyContext = {
  workspacePath: string | null;
};

/** Aplica um único ficheiro durante o stream SSE (HMR quando o dev server já corre). */
export async function applyDevStudioFileIncremental(
  file: { path: string; content: string },
  ctx: IncrementalApplyContext,
): Promise<boolean> {
  const path = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path) return false;

  if (isElectron()) {
    const wp = ctx.workspacePath?.trim();
    if (!wp) return false;
    const wr = await desktopPolvoCode.writeFile({
      workspacePath: wp,
      relPath: path,
      content: file.content,
      createDirs: true,
    });
    return wr.ok;
  }

  const svc = getWebContainerPreviewService();
  const op: DevStudioOp = { op: "write", path, content: file.content };
  svc.mergeOps([op]);
  return true;
}
