/**
 * Remove imports inválidos em projectos preview (ex.: react-router-dom sem estar no package.json).
 */

import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { fixAppTsxIfRouterBroken, stripReactRouterJsx, usesRouterJsx } from "./routerJsxStrip";

const FORBIDDEN_PACKAGES = [
  "react-router-dom",
  "react-router",
  "@tanstack/react-query",
  "next/link",
  "next/navigation",
] as const;

const FORBIDDEN_IMPORT_RE = new RegExp(
  `^\\s*import\\s+[^;]*from\\s+["'](${FORBIDDEN_PACKAGES.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})["'];?\\s*$`,
  "m",
);

const ANY_FORBIDDEN_RE = new RegExp(
  `from\\s+["'](${FORBIDDEN_PACKAGES.join("|")})["']`,
);

export function previewSourceHasForbiddenImports(content: string): boolean {
  return ANY_FORBIDDEN_RE.test(content);
}

/** Converte Link (react-router) em âncoras HTML; remove imports e JSX de router. */
export function sanitizePreviewTsx(content: string, filePath = ""): string {
  if (!content.trim()) return content;
  const isTsx =
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".jsx") ||
    (!filePath && /<[A-Z]/.test(content));
  if (!isTsx) return content;

  const lines = content.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (FORBIDDEN_IMPORT_RE.test(line.trim())) continue;
    if (/^\s*import\s+.*react-router/.test(line)) continue;
    kept.push(line);
  }

  let out = kept.join("\n");

  out = out.replace(/<Link\b/g, "<a");
  out = out.replace(/<\/Link>/g, "</a>");
  out = out.replace(/\sto=\{/g, " href={");
  out = out.replace(/\sto="/g, ' href="');
  out = out.replace(/\sto='/g, " href='");
  out = out.replace(/\scomponent=\{[^}]+\}/g, "");

  out = stripReactRouterJsx(out);
  const norm = filePath.replace(/\\/g, "/").replace(/^\//, "");
  if (norm === "src/App.tsx" || (!filePath && usesRouterJsx(out))) {
    out = fixAppTsxIfRouterBroken(out);
  }

  return out;
}

export function sanitizeDevStudioOps(ops: DevStudioOp[]) {
  return ops.map((op) => {
    if (op.op !== "write" || !op.content) return op;
    const path = op.path.replace(/\\/g, "/");
    if (!/\.(tsx|jsx)$/.test(path)) return op;
    return {
      ...op,
      content: sanitizePreviewTsx(op.content, path),
    };
  });
}
