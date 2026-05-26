import type { DevStudioOp } from "@/lib/devStudioMetadata";

/** Identificador virtual quando o projecto corre no browser (WebContainer). */
export const WEBCONTAINER_WORKSPACE_ID = "webcontainer://preview";

export type WebContainerPreviewPhase =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export type WebContainerPreviewEvent =
  | { type: "phase"; phase: WebContainerPreviewPhase; message?: string }
  | { type: "log"; line: string }
  | { type: "url"; url: string }
  | { type: "error"; message: string };

export type MountProjectOptions = {
  ops: DevStudioOp[];
  npmInstall?: boolean;
  devCommand?: string[];
  installCommand?: string[];
};

export function isWebContainerSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.crossOriginIsolated);
}

export function isWebContainerWorkspace(workspacePath: string | null | undefined): boolean {
  return (workspacePath ?? "").trim() === WEBCONTAINER_WORKSPACE_ID;
}

/** Árvore de ficheiros plana path → conteúdo (estado do projecto virtual). */
export type VirtualProjectFiles = Record<string, string>;
