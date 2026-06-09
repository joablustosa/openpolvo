import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron, type PolvoCodeEvent } from "@/lib/desktopApi";
import {
  DEV_STUDIO_APPLY_END,
  DEV_STUDIO_APPLY_START,
} from "@/lib/devStudioApplyEvents";
import {
  getLastDevStudioUrl,
  subscribeDevStudioPreview,
} from "@/lib/devStudioPreviewBus";
import {
  getWebContainerPreviewService,
  isWebContainerSupported,
  isWebContainerWorkspace,
} from "@/lib/webcontainer";
import {
  appendDevStudioCompileLog,
  devStudioHasCompileErrors,
  devStudioHasPreviewErrors,
} from "@/lib/devStudio/compileLogBuffer";
import {
  schedulePreviewAutoHeal,
} from "@/lib/devStudio/previewAutoHeal";
import { installPreviewConsoleBridge } from "@/lib/devStudio/previewConsoleBridge";
import {
  devPreviewStatusAfterStart,
  ensureElectronDevPreview,
} from "@/lib/devStudio/electronDevPreview";
import { DEV_STUDIO_PREVIEW_PORT } from "@/modules/dev-studio/config";

export type DevStudioPhase =
  | "idle"
  | "applying"
  | "installing"
  | "starting"
  | "ready"
  | "error";

function phaseLabel(phase: DevStudioPhase): string {
  switch (phase) {
    case "applying":
      return "A aplicar alterações do agente…";
    case "installing":
      return "A instalar dependências…";
    case "starting":
      return "A iniciar preview…";
    case "ready":
      return "Preview activo";
    case "error":
      return "Erro no preview";
    default:
      return "Aguardando projecto";
  }
}

const FALLBACK_DEV_URL = `http://127.0.0.1:${DEV_STUDIO_PREVIEW_PORT}/`;

export function useDevStudioRuntime(workspacePath: string, previewGeneration: number) {
  const [devUrl, setDevUrl] = useState("");
  const [phase, setPhase] = useState<DevStudioPhase>("idle");
  const [statusLine, setStatusLine] = useState("");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [lastLogLine, setLastLogLine] = useState<string | null>(null);
  const previewRunId = useRef(0);
  const useWebContainer = isWebContainerWorkspace(workspacePath);
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;

  const bumpPreview = useCallback(() => {
    setPreviewReloadKey((k) => k + 1);
  }, []);

  const applyDevUrl = useCallback(
    (url: string) => {
      const u = url.trim();
      if (!u) return;
      setDevUrl(u);
      setPhase("ready");
      setStatusLine(phaseLabel("ready"));
      bumpPreview();
    },
    [bumpPreview],
  );

  const startPreview = useCallback(async () => {
    const root = workspacePath.trim();
    if (!root) return;

    const runId = ++previewRunId.current;

    if (useWebContainer) {
      if (!isWebContainerSupported()) {
        if (runId !== previewRunId.current) return;
        setPhase("error");
        setStatusLine("WebContainer indisponível (COOP/COEP).");
        return;
      }
      setPhase("starting");
      setStatusLine("A reiniciar preview no browser…");
      try {
        const svc = getWebContainerPreviewService();
        const url = await svc.runProject({
          ops: [],
          npmInstall: !svc.hasInstalledOnce(),
        });
        if (runId !== previewRunId.current) return;
        applyDevUrl(url);
      } catch (e) {
        if (runId !== previewRunId.current) return;
        setPhase("error");
        setStatusLine(e instanceof Error ? e.message : "Falha no WebContainer");
      }
      return;
    }

    if (!isElectron()) return;

    setPhase("starting");
    setStatusLine(phaseLabel("starting"));
    try {
      const url = await ensureElectronDevPreview(root);
      if (runId !== previewRunId.current) return;

      const { hasCompileErrors } = devPreviewStatusAfterStart();
      applyDevUrl(url);
      if (hasCompileErrors) {
        setStatusLine("Preview com erros de compilação — use o chat para corrigir.");
      }
    } catch (e) {
      if (runId !== previewRunId.current) return;
      setPhase("error");
      setStatusLine(e instanceof Error ? e.message : "Falha ao iniciar o preview");
    }
  }, [workspacePath, useWebContainer, applyDevUrl]);

  useEffect(() => {
    if (!useWebContainer) return;
    const svc = getWebContainerPreviewService();
    const existing = svc.getPreviewUrl();
    if (existing) applyDevUrl(existing);

    return svc.subscribe((ev) => {
      if (ev.type === "log") {
        const line = ev.line.trim();
        if (line) {
          setLastLogLine(line.slice(-200));
          // Espelha no buffer global para que o auto-heal (que lê esse buffer)
          // detecte erros de build/runtime do WebContainer.
          appendDevStudioCompileLog(line);
          if (devStudioHasPreviewErrors()) {
            schedulePreviewAutoHeal(workspacePathRef.current);
          }
        }
      } else if (ev.type === "phase") {
        const p = ev.phase;
        if (p === "installing" || p === "mounting") {
          setPhase("installing");
          setStatusLine(phaseLabel("installing"));
        } else if (p === "starting" || p === "booting") {
          setPhase("starting");
          setStatusLine(phaseLabel("starting"));
        } else if (p === "error") {
          setPhase("error");
          setStatusLine(ev.message ?? phaseLabel("error"));
        }
      } else if (ev.type === "url") {
        applyDevUrl(ev.url);
      } else if (ev.type === "error") {
        setPhase("error");
        setStatusLine(ev.message);
      }
    });
  }, [useWebContainer, applyDevUrl]);

  useEffect(() => {
    if (useWebContainer || !isElectron()) return;
    return subscribeDevStudioPreview((ev: PolvoCodeEvent) => {
      if (ev.type === "log") {
        const line = ev.line.trim();
        if (line) setLastLogLine(line.slice(-200));
        if (/npm install/i.test(ev.line)) {
          setPhase("installing");
          setStatusLine(phaseLabel("installing"));
        }
        if (devStudioHasPreviewErrors()) {
          schedulePreviewAutoHeal(workspacePathRef.current);
        }
      } else if (ev.type === "url" && ev.url) {
        applyDevUrl(ev.url);
        if (devStudioHasCompileErrors()) {
          setStatusLine("Erro de compilação no Vite — a corrigir…");
        }
      } else if (ev.type === "exit") {
        if (ev.phase === "install" && ev.code !== 0) {
          setPhase("error");
          setStatusLine(`npm install terminou com código ${ev.code ?? "?"}`);
        } else if (ev.phase === "dev" && ev.code !== 0 && ev.code !== null) {
          setPhase("error");
          setStatusLine(`Servidor de preview terminou (código ${ev.code}).`);
        }
      }
    });
  }, [useWebContainer, applyDevUrl]);

  useEffect(() => {
    const onStart = () => {
      setPhase("applying");
      setStatusLine(phaseLabel("applying"));
    };
    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent<{ success?: boolean; detail?: string }>).detail;
      if (detail?.success) {
        const url = getLastDevStudioUrl();
        if (url) {
          applyDevUrl(url);
          if (devStudioHasCompileErrors()) {
            setStatusLine("Erro de compilação no Vite — a corrigir…");
          }
          return;
        }
        setPhase("starting");
        setStatusLine(phaseLabel("starting"));
      } else if (detail?.detail) {
        setPhase("error");
        setStatusLine(detail.detail);
      }
    };
    window.addEventListener(DEV_STUDIO_APPLY_START, onStart);
    window.addEventListener(DEV_STUDIO_APPLY_END, onEnd);
    return () => {
      window.removeEventListener(DEV_STUDIO_APPLY_START, onStart);
      window.removeEventListener(DEV_STUDIO_APPLY_END, onEnd);
    };
  }, [applyDevUrl]);

  // Ponte do console da iframe (WebContainer) → buffer de logs + auto-heal.
  useEffect(() => {
    return installPreviewConsoleBridge(() => workspacePathRef.current);
  }, []);

  useEffect(() => {
    if (!workspacePath.trim()) {
      setDevUrl("");
      setPhase("idle");
      setStatusLine(phaseLabel("idle"));
      return;
    }
    if (useWebContainer) {
      const svc = getWebContainerPreviewService();
      const existing = svc.getPreviewUrl();
      if (existing) {
        applyDevUrl(existing);
      } else if (svc.hasVirtualFiles()) {
        // Conversa restaurada com projecto, mas sem preview a correr → arranca.
        void startPreview();
      }
      return;
    }
    void startPreview();
    return () => {
      previewRunId.current += 1;
    };
  }, [workspacePath, previewGeneration, startPreview, useWebContainer, applyDevUrl]);

  useEffect(() => {
    if (useWebContainer || phase !== "starting" || devUrl) return;
    const timer = window.setTimeout(() => {
      if (devStudioHasCompileErrors()) {
        setPhase("error");
        setStatusLine("Erro de compilação no preview (Vite).");
        return;
      }
      const url = getLastDevStudioUrl() || FALLBACK_DEV_URL;
      applyDevUrl(url);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [phase, devUrl, applyDevUrl, useWebContainer]);

  return {
    devUrl,
    phase,
    statusLine,
    previewReloadKey,
    lastLogLine,
    bumpPreview,
    startPreview,
    phaseLabel,
    useWebContainer,
  };
}
