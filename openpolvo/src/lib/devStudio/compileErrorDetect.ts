/** Detecta erros de build Vite/tsc nos logs do preview (Electron ou WebContainer). */
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
