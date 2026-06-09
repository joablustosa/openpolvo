/**
 * Monta payload Dev Studio para enviar com cada mensagem de chat.
 * Alimenta Context_Manager, Code RAG, Router e multi-turn.
 */

import { collectElectronProjectFiles } from "@/lib/devStudio/collectElectronProjectFiles";
import {
  devStudioHasCompileErrors,
  devStudioHasPreviewErrors,
  getDevStudioCompileLog,
  previewConsoleLogsFromCompileLog,
} from "@/lib/devStudio/compileLogBuffer";
import { parseDevStudioMessageMeta } from "@/lib/devStudioMetadata";
import type { MessageDTO } from "@/lib/conversationsApi";
import { isElectron } from "@/lib/desktopApi";

export type DevStudioChatPayload = {
  sandbox_project_id?: string;
  project_file_tree?: string[];
  project_files?: Record<string, string>;
  preview_console_logs?: Array<{
    level: string;
    message: string;
    source?: string;
  }>;
  dev_studio_context?: Record<string, unknown>;
  compile_log?: string;
};

const MAX_FILES = 80;
const MAX_BYTES_PER_FILE = 48_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
]);
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".lock",
]);
const PRIORITY_SUBSTRINGS = [
  "package.json",
  "middleware",
  "next.config",
  "vite.config",
  "tsconfig",
  "go.mod",
  "src/",
  "app/",
  "internal/",
  "routes",
  "auth",
  "supabase",
];

function shouldIndexFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  const dot = p.lastIndexOf(".");
  const ext = dot >= 0 ? p.slice(dot).toLowerCase() : "";
  if (SKIP_EXT.has(ext)) return false;
  if (!ext && !PRIORITY_SUBSTRINGS.some((s) => p.includes(s))) return false;
  return true;
}

function scorePath(path: string): number {
  const p = path.toLowerCase();
  let s = 0;
  for (let i = 0; i < PRIORITY_SUBSTRINGS.length; i++) {
    if (p.includes(PRIORITY_SUBSTRINGS[i])) s += 100 - i;
  }
  return s;
}

function trimFileContent(content: string): string {
  const enc = new TextEncoder().encode(content);
  if (enc.length <= MAX_BYTES_PER_FILE) return content;
  return new TextDecoder().decode(enc.slice(0, MAX_BYTES_PER_FILE));
}

function extractDevStudioContext(messages: MessageDTO[]): Record<string, unknown> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const meta = parseDevStudioMessageMeta(m.metadata);
    const raw = m.metadata;
    if (!raw || typeof raw !== "object") continue;
    const dsc = (raw as Record<string, unknown>).dev_studio_context;
    if (dsc && typeof dsc === "object" && !Array.isArray(dsc)) {
      return dsc as Record<string, unknown>;
    }
    if (meta?.routed_intent === "polvo_code_builder") {
      return {
        compact_context_map: (raw as Record<string, unknown>).compact_context_map,
        project_digest: (raw as Record<string, unknown>).project_digest,
      };
    }
  }
  return undefined;
}

async function collectElectronSnapshot(
  workspacePath: string,
): Promise<{ tree: string[]; files: Record<string, string> }> {
  const files = await collectElectronProjectFiles(workspacePath);
  const tree = Object.keys(files).sort((a, b) => scorePath(b) - scorePath(a));
  return { tree, files };
}

async function collectWebContainerSnapshot(): Promise<{
  tree: string[];
  files: Record<string, string>;
  compileLog: string;
  previewLogs: DevStudioChatPayload["preview_console_logs"];
}> {
  const { getWebContainerPreviewService, isWebContainerSupported } =
    await import("@/lib/webcontainer");
  if (!isWebContainerSupported()) {
    return { tree: [], files: {}, compileLog: "", previewLogs: [] };
  }
  const svc = getWebContainerPreviewService();
  const virtual = svc.getVirtualFiles();
  const tree = Object.keys(virtual)
    .filter(shouldIndexFile)
    .sort((a, b) => scorePath(b) - scorePath(a))
    .slice(0, MAX_FILES);
  const files: Record<string, string> = {};
  for (const p of tree) {
    files[p] = trimFileContent(virtual[p] ?? "");
  }
  const compileLog = svc.getCompileLog?.() ?? "";
  const previewLogs = compileLog
    .split("\n")
    .filter((line) => /error|failed|warn/i.test(line))
    .slice(-40)
    .map((message) => ({ level: "error", message: message.trim() }));
  return { tree, files, compileLog, previewLogs };
}

export type CollectDevStudioChatPayloadOptions = {
  workspacePath: string | null;
  messages: MessageDTO[];
};

/** Recolhe snapshot do projecto + contexto do turno anterior para o Intelligence. */
export async function collectDevStudioChatPayload(
  options: CollectDevStudioChatPayloadOptions,
): Promise<DevStudioChatPayload> {
  const { workspacePath, messages } = options;
  const payload: DevStudioChatPayload = {};

  const prevCtx = extractDevStudioContext(messages);
  if (prevCtx && Object.keys(prevCtx).length) {
    payload.dev_studio_context = prevCtx;
  }

  const wp = workspacePath?.trim() ?? "";
  const { isWebContainerWorkspace, getWebContainerPreviewService } =
    await import("@/lib/webcontainer");

  if (wp && isWebContainerWorkspace(wp)) {
    const snap = await collectWebContainerSnapshot();
    if (snap.tree.length) {
      payload.sandbox_project_id = wp;
      payload.project_file_tree = snap.tree;
      payload.project_files = snap.files;
    }
    // O runtime espelha os logs do dev server no buffer global e a ponte injecta
    // os erros de runtime da consola da iframe — logo o buffer global é superset.
    // Usa-o quando existe (preview montado); caso contrário, o snapshot do svc.
    const globalLog = getDevStudioCompileLog().trim();
    const combinedLog = globalLog || snap.compileLog.trim();
    const hasErrors =
      getWebContainerPreviewService().hasCompileErrors?.() === true ||
      devStudioHasPreviewErrors();
    if (combinedLog && hasErrors) {
      payload.compile_log = combinedLog.slice(-8000);
      payload.preview_console_logs = previewConsoleLogsFromCompileLog(combinedLog);
    } else if (snap.previewLogs?.length) {
      payload.preview_console_logs = snap.previewLogs;
    }
    return payload;
  }

  if (wp && isElectron()) {
    const snap = await collectElectronSnapshot(wp);
    if (snap.tree.length) {
      payload.sandbox_project_id = wp;
      payload.project_file_tree = snap.tree;
      payload.project_files = snap.files;
    }
    const compileLog = getDevStudioCompileLog();
    if (compileLog.trim() && devStudioHasCompileErrors()) {
      payload.compile_log = compileLog.slice(-8000);
      payload.preview_console_logs = previewConsoleLogsFromCompileLog(compileLog);
    }
    return payload;
  }

  const prevFiles = prevCtx?.project_files;
  if (prevFiles && typeof prevFiles === "object" && !Array.isArray(prevFiles)) {
    const pf = prevFiles as Record<string, string>;
    const tree = Object.keys(pf).slice(0, MAX_FILES);
    payload.project_file_tree = tree;
    payload.project_files = Object.fromEntries(
      tree.map((k) => [k, trimFileContent(String(pf[k] ?? ""))]),
    );
    if (typeof prevCtx?.project_id === "string") {
      payload.sandbox_project_id = prevCtx.project_id;
    }
  }

  return payload;
}
