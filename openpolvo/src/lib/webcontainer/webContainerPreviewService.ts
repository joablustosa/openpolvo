/**
 * Preview in-browser via StackBlitz WebContainers — zero infra de servidor nossa.
 * Fluxo: boot → mount(files) → npm install → npm run dev → server-ready → iframe URL.
 */

import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import { WebContainer as WebContainerApi } from "@webcontainer/api";

import type { DevStudioOp } from "@/lib/devStudioMetadata";
import {
  applyOpsToVirtualFiles,
  ensureRunnableViteProject,
  flatFilesToFileSystemTree,
} from "./opsToFileTree";
import type {
  MountProjectOptions,
  VirtualProjectFiles,
  WebContainerPreviewEvent,
  WebContainerPreviewPhase,
} from "./types";
import { detectCompileErrors } from "@/lib/devStudio/compileErrorDetect";
import { isWebContainerSupported } from "./types";

const POST_READY_COMPILE_SCAN_MS = 2500;

type Listener = (ev: WebContainerPreviewEvent) => void;

let bootPromise: Promise<WebContainer> | null = null;

async function getOrBootContainer(onLog: (line: string) => void): Promise<WebContainer> {
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    onLog("A iniciar WebContainer…");
    const instance = await WebContainerApi.boot();
    instance.on("error", (err) => {
      onLog(`[webcontainer error] ${String(err)}`);
    });
    instance.on("server-ready", (port, url) => {
      onLog(`Servidor pronto na porta ${port}: ${url}`);
    });
    return instance;
  })();

  try {
    return await bootPromise;
  } catch (e) {
    bootPromise = null;
    throw e;
  }
}

async function pipeProcessOutput(process: WebContainerProcess, onLog: (line: string) => void) {
  const reader = process.output.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) onLog(String(value).trimEnd());
    }
  } catch {
    /* stream fechado */
  }
}

export class WebContainerPreviewService {
  private container: WebContainer | null = null;
  private virtualFiles: VirtualProjectFiles = {};
  private previewUrl = "";
  private phase: WebContainerPreviewPhase = "idle";
  private devProcess: WebContainerProcess | null = null;
  private runGeneration = 0;
  private listeners = new Set<Listener>();
  private serverReadyUnsub: (() => void) | null = null;
  private compileLogLines: string[] = [];
  /** Conversa activa cujo projecto virtual está montado. */
  private conversationId = "";
  /** Estado dos projectos virtuais por conversa (isolamento). */
  private savedStates = new Map<string, VirtualProjectFiles>();
  /** `npm install` já correu nesta instância de container (node_modules partilhado). */
  private installedOnce = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getConversationId(): string {
    return this.conversationId;
  }

  hasVirtualFiles(): boolean {
    return Object.keys(this.virtualFiles).length > 0;
  }

  hasInstalledOnce(): boolean {
    return this.installedOnce;
  }

  /** Substitui os ficheiros virtuais (ex.: hidratação a partir do backend). */
  setVirtualFiles(files: VirtualProjectFiles): void {
    this.virtualFiles = { ...files };
  }

  /**
   * Troca a conversa activa: guarda o estado actual e restaura o do destino.
   * Como há um único WebContainer por página, paramos o dev server e limpamos o
   * URL para forçar re-mount/run da conversa-alvo. Devolve `true` se mudou.
   */
  async switchConversation(conversationId: string): Promise<boolean> {
    const next = conversationId.trim();
    if (next === this.conversationId) return false;
    if (this.conversationId) {
      this.savedStates.set(this.conversationId, { ...this.virtualFiles });
    }
    await this.stopDevProcess();
    this.runGeneration += 1;
    this.conversationId = next;
    const saved = next ? this.savedStates.get(next) : undefined;
    this.virtualFiles = saved ? { ...saved } : {};
    this.previewUrl = "";
    this.compileLogLines = [];
    this.setPhase("idle");
    return true;
  }

  /** Remove o estado guardado de uma conversa (ex.: ao eliminá-la). */
  forgetConversation(conversationId: string): void {
    const id = conversationId.trim();
    if (!id) return;
    this.savedStates.delete(id);
    if (id === this.conversationId) {
      this.conversationId = "";
      this.virtualFiles = {};
      this.previewUrl = "";
      this.compileLogLines = [];
    }
  }

  getPreviewUrl(): string {
    return this.previewUrl;
  }

  getPhase(): WebContainerPreviewPhase {
    return this.phase;
  }

  getVirtualFiles(): VirtualProjectFiles {
    return { ...this.virtualFiles };
  }

  getVirtualFileTree(): string[] {
    return Object.keys(this.virtualFiles).sort();
  }

  getCompileLog(): string {
    return this.compileLogLines.join("\n");
  }

  hasCompileErrors(): boolean {
    return detectCompileErrors(this.getCompileLog());
  }

  private appendCompileLog(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.compileLogLines.push(trimmed);
    if (this.compileLogLines.length > 400) {
      this.compileLogLines = this.compileLogLines.slice(-300);
    }
  }

  private emit(ev: WebContainerPreviewEvent) {
    for (const fn of this.listeners) fn(ev);
  }

  private setPhase(phase: WebContainerPreviewPhase, message?: string) {
    this.phase = phase;
    this.emit({ type: "phase", phase, message });
  }

  /** Funde ops da IA no projecto virtual (sem boot). */
  mergeOps(ops: DevStudioOp[]): VirtualProjectFiles {
    this.virtualFiles = applyOpsToVirtualFiles(this.virtualFiles, ops);
    return this.getVirtualFiles();
  }

  /** Monta projecto, instala deps e arranca dev server; devolve URL do preview. */
  async runProject(options: MountProjectOptions): Promise<string> {
    if (!isWebContainerSupported()) {
      const msg =
        "WebContainer indisponível: a app precisa de Cross-Origin Isolation (COOP/COEP). Recarregue via Vite dev.";
      this.setPhase("error", msg);
      this.emit({ type: "error", message: msg });
      throw new Error(msg);
    }

    const gen = ++this.runGeneration;
    this.compileLogLines = [];
    const log = (line: string) => {
      this.appendCompileLog(line);
      this.emit({ type: "log", line });
    };

    if (options.ops.length) {
      this.mergeOps(options.ops);
    }
    this.virtualFiles = ensureRunnableViteProject(
      this.virtualFiles,
      options.designTokens,
    );

    try {
      this.setPhase("booting");
      this.container = await getOrBootContainer(log);
      if (gen !== this.runGeneration) return this.previewUrl;

      await this.stopDevProcess();

      this.setPhase("mounting");
      const tree = flatFilesToFileSystemTree(this.virtualFiles);
      await this.container.mount(tree);
      if (gen !== this.runGeneration) return this.previewUrl;

      if (options.npmInstall !== false) {
        this.setPhase("installing");
        const installCmd = options.installCommand ?? ["npm", "install"];
        const installProc = await this.container.spawn(installCmd[0], installCmd.slice(1));
        void pipeProcessOutput(installProc, log);
        const installCode = await installProc.exit;
        if (gen !== this.runGeneration) return this.previewUrl;
        if (installCode !== 0) {
          throw new Error(`npm install terminou com código ${installCode}`);
        }
        this.installedOnce = true;
      }

      this.setPhase("starting");
      const devCmd = options.devCommand ?? ["npm", "run", "dev"];
      const urlPromise = new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Timeout à espera do servidor de preview (90s)"));
        }, 90_000);

        if (this.serverReadyUnsub) {
          this.serverReadyUnsub();
        }
        this.serverReadyUnsub = this.container!.on("server-ready", (_port, url) => {
          window.clearTimeout(timeout);
          this.previewUrl = url;
          this.setPhase("ready");
          this.emit({ type: "url", url });
          resolve(url);
        });
      });

      this.devProcess = await this.container.spawn(devCmd[0], devCmd.slice(1));
      void pipeProcessOutput(this.devProcess, log);

      const url = await urlPromise;
      if (gen !== this.runGeneration) return this.previewUrl;

      await new Promise((r) => window.setTimeout(r, POST_READY_COMPILE_SCAN_MS));
      if (gen !== this.runGeneration) return this.previewUrl;
      if (detectCompileErrors(this.getCompileLog())) {
        throw new Error(
          this.getCompileLog().slice(-1500) || "Erro de compilação detectado no preview",
        );
      }

      return url;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.setPhase("error", message);
      this.emit({ type: "error", message });
      throw e;
    }
  }

  private async stopDevProcess() {
    if (this.devProcess) {
      try {
        this.devProcess.kill();
      } catch {
        /* ignore */
      }
      this.devProcess = null;
    }
    if (this.serverReadyUnsub) {
      this.serverReadyUnsub();
      this.serverReadyUnsub = null;
    }
  }

  async teardown() {
    this.runGeneration += 1;
    await this.stopDevProcess();
    this.previewUrl = "";
    this.virtualFiles = {};
    this.compileLogLines = [];
    this.installedOnce = false;
    this.setPhase("idle");
    bootPromise = null;
    if (this.container) {
      try {
        this.container.teardown();
      } catch {
        /* ignore */
      }
      this.container = null;
    }
  }
}

let singleton: WebContainerPreviewService | null = null;

export function getWebContainerPreviewService(): WebContainerPreviewService {
  if (!singleton) singleton = new WebContainerPreviewService();
  return singleton;
}

export async function applyOpsInWebContainer(
  ops: DevStudioOp[],
  npmInstall = true,
): Promise<string> {
  const svc = getWebContainerPreviewService();
  return svc.runProject({ ops, npmInstall });
}
