/**
 * Correcções rápidas para ReferenceError (sem LLM).
 * Não adiciona react-router-dom — o scaffold não inclui essa dependência.
 */

import type { DevStudioOp } from "@/lib/devStudioMetadata";
import { buildRouterReferenceHealOps } from "./routerJsxStrip";

const UNDEFINED_SYM_RE =
  /ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/i;

const ROUTER_SYMBOLS = new Set([
  "Router",
  "Routes",
  "Route",
  "Link",
  "Navigate",
  "Outlet",
  "BrowserRouter",
]);

export function buildUndefinedSymbolHealOps(
  compileLog: string,
  projectFiles?: Record<string, string>,
): DevStudioOp[] | null {
  if (!projectFiles) return null;

  const routerHeal = buildRouterReferenceHealOps(compileLog, projectFiles);
  if (routerHeal?.length) return routerHeal;

  const symMatch = compileLog.match(UNDEFINED_SYM_RE);
  if (!symMatch) return null;
  const symbol = symMatch[1];
  if (ROUTER_SYMBOLS.has(symbol)) {
    return buildRouterReferenceHealOps(
      `ReferenceError: ${symbol} is not defined`,
      projectFiles,
    );
  }

  return null;
}
