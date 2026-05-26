import { useCallback, useEffect, useRef, useState } from "react";
import { desktopPolvoCode, isElectron, type PolvoCodeEvent } from "@/lib/desktopApi";
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
  devStudioHasCompileErrors,
  getDevStudioCompileLog,
} from "@/lib/devStudio/compileLogBuffer";
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
  const startInFlight = useRef(false);
  const useWebContainer = isWebContainerWorkspace(workspacePath);

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
    if (!workspacePath.trim() || startInFlight.current) return;

    if (useWebContainer) {
      if (!isWebContainerSupported()) {
        setPhase("error");
        setStatusLine("WebContainer indisponível (COOP/COEP).");
        return;
      }
      startInFlight.current = true;
      setPhase("starting");
      setStatusLine("A reiniciar preview no browser…");
      try {
        const svc = getWebContainerPreviewService();
        const url = await svc.runProject({ ops: [], npmInstall: false });
        applyDevUrl(url);
      } catch (e) {
        setPhase("error");
        setStatusLine(e instanceof Error ? e.message : "Falha no WebContainer");
      } finally {
        startInFlight.current = false;
      }
      return;
    }

    if (!isElectron()) return;
    startInFlight.current = true;
    setPhase("starting");
    setStatusLine(phaseLabel("starting"));
    try {
      await desktopPolvoCode.devStop();
      const r = await desktopPolvoCode.devStart({
        workspacePath,
        port: DEV_STUDIO_PREVIEW_PORT,
        openBrowser: false,
      });
      if (!r.ok) {
        setPhase("error");
        setStatusLine(r.error ?? "Falha ao iniciar o servidor de preview.");
        return;
      }
      const cached = getLastDevStudioUrl();
      if (cached) {
        applyDevUrl(cached);
      } else {
        applyDevUrl(FALLBACK_DEV_URL);
      }
    } finally {
      startInFlight.current = false;
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
        if (line) setLastLogLine(line.slice(-200));
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
      } else if (ev.type === "url" && ev.url) {
        if (devStudioHasCompileErrors()) {
          setPhase("error");
          setStatusLine("Erro de compilação no Vite — a corrigir…");
        } else {
          applyDevUrl(ev.url);
        }
      } else if (ev.type === "exit") {
        if (ev.intentional) return;
        if (ev.phase === "install" && ev.code !== 0) {
          setPhase("error");
          setStatusLine(`npm install terminou com código ${ev.code ?? "?"}`);
        } else if (ev.phase === "dev" && ev.code !== 0 && ev.code !== null) {
          setPhase("error");
          const hint = /already in use|EADDRINUSE/i.test(getDevStudioCompileLog())
            ? " Porta do preview ocupada — tenta «Reiniciar preview»."
            : "";
          setStatusLine(`Servidor de preview terminou (código ${ev.code}).${hint}`);
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
        if (url && !devStudioHasCompileErrors()) {
          applyDevUrl(url);
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

  useEffect(() => {
    if (!workspacePath.trim()) {
      setDevUrl("");
      setPhase("idle");
      setStatusLine(phaseLabel("idle"));
      return;
    }
    if (useWebContainer) {
      const svc = getWebContainerPreviewService();
      if (svc.getPreviewUrl()) {
        applyDevUrl(svc.getPreviewUrl());
      }
      return;
    }
    void startPreview();
  }, [workspacePath, previewGeneration, startPreview, useWebContainer, applyDevUrl]);

  useEffect(() => {
    if (useWebContainer || phase !== "starting" || devUrl) return;
    const timer = window.setTimeout(() => {
      if (devStudioHasCompileErrors()) {
        setPhase("error");
        setStatusLine("Erro de compilação no preview (Vite).");
        return;
      }
      setDevUrl((prev) => prev || FALLBACK_DEV_URL);
      setPhase("ready");
      setStatusLine(phaseLabel("ready"));
      bumpPreview();
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [phase, devUrl, bumpPreview, useWebContainer]);

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
