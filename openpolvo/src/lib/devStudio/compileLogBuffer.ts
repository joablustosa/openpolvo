import { detectCompileErrors } from "@/lib/devStudio/compileErrorDetect";

const MAX_LINES = 400;

let lines: string[] = [];

export function appendDevStudioCompileLog(line: string): void {
  const t = line.trim();
  if (!t) return;
  lines.push(t);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-300);
  }
}

export function clearDevStudioCompileLog(): void {
  lines = [];
}

export function getDevStudioCompileLog(): string {
  return lines.join("\n");
}

export function devStudioHasCompileErrors(): boolean {
  return detectCompileErrors(getDevStudioCompileLog());
}

export function previewConsoleLogsFromCompileLog(
  compileLog: string,
): Array<{ level: string; message: string }> {
  return compileLog
    .split("\n")
    .filter((line) => /error|failed|syntax/i.test(line))
    .slice(-40)
    .map((message) => ({ level: "error", message: message.trim() }));
}
