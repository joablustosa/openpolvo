/** Erros de build Vite/tsc e erros de runtime na consola do preview (React, etc.). */

export function detectCompileErrors(log: string): boolean {
  if (!log.trim()) return false;
  if (/\berror TS\d+\b/i.test(log)) return true;
  if (/\[plugin:vite(:esbuild|:import-analysis)?\]/i.test(log)) return true;
  if (/pre-transform error/i.test(log)) return true;
  if (/failed to resolve import/i.test(log)) return true;
  if (/syntaxerror/i.test(log)) return true;
  if (/unexpected token/i.test(log)) return true;
  if (/×\s/i.test(log) && /error/i.test(log)) return true;
  return false;
}

export function detectRuntimePreviewErrors(log: string): boolean {
  if (!log.trim()) return false;
  if (/\bdoes not provide an export named\b/i.test(log)) return true;
  if (/\bUncaught\s+\w+Error\b/i.test(log)) return true;
  if (/\bReferenceError:\s*\w+\s+is not defined\b/i.test(log)) return true;
  if (/\bTypeError:\s+/i.test(log)) return true;
  if (/The above error occurred in the </i.test(log)) return true;
  if (/\[console\].*\berror\b/i.test(log)) return true;
  if (/\bat \w+ \(.*\.tsx?:\d+/i.test(log) && /error/i.test(log)) return true;
  return false;
}

/** Build Vite ou runtime na consola do preview. */
export function detectPreviewErrors(log: string): boolean {
  return detectCompileErrors(log) || detectRuntimePreviewErrors(log);
}
