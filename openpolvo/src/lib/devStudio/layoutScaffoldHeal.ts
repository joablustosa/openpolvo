import type { DevStudioOp } from "@/lib/devStudioMetadata";
import {
  getShadcnViteScaffold,
  type DesignTokens,
} from "@/lib/webcontainer/shadcnScaffold";

export const LAYOUT_SCAFFOLD_PATHS = [
  "src/components/layout/AppShell.tsx",
  "src/components/layout/Navbar.tsx",
  "src/components/layout/Sidebar.tsx",
] as const;

const LAYOUT_IMPORT_ERROR_RE =
  /Failed to resolve import|react-router-dom|react-router|\.\/Sidebar|\.\/Navbar|AppShell\.tsx/i;

/** Restaura ficheiros de layout do scaffold (sem react-router-dom, AppShell sem import Sidebar). */
export function buildLayoutScaffoldHealOps(
  compileLog: string,
  designTokens?: Partial<DesignTokens>,
): DevStudioOp[] | null {
  if (!LAYOUT_IMPORT_ERROR_RE.test(compileLog)) {
    return null;
  }

  const scaffold = getShadcnViteScaffold(designTokens);
  const ops: DevStudioOp[] = [];

  for (const path of LAYOUT_SCAFFOLD_PATHS) {
    const content = scaffold[path];
    if (content) {
      ops.push({ op: "write", path, content });
    }
  }

  return ops.length ? ops : null;
}
