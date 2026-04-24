/**
 * Preview ao vivo via WebContainer (StackBlitz `@webcontainer/api`).
 *
 * COOP / COEP — obrigatório para crossOriginIsolated = true:
 *   vite.config.ts  → server.headers: { COOP: same-origin, COEP: require-corp }
 *   electron dev    → session.defaultSession.webRequest.onHeadersReceived (main.cjs)
 *   electron prod   → usa servidor HTTP local ou protocol.registerSchemesAsPrivileged
 *
 * ACTUALIZAÇÃO INSTANTÂNEA (padrão Lovable / Claude):
 *   Quando o utilizador pede alterações no chat, os ficheiros são patchados via HMR
 *   sem reiniciar o container. Só reinstala dependências se o package.json mudar.
 *
 * O servidor dev NÃO é morto ao desmontar o componente — persiste para restauro
 * instantâneo ao regressar ao mesmo projecto.
 *
 * Fase 2 (opcional): se o embed continuar problemático em Electron, avaliar
 * `@codesandbox/sandpack-react` para React sem WebContainer no iframe do host.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  RefreshCw,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import type { BuilderData, BuilderFile } from "@/lib/builderMetadata";
import { builderFilesSignature, normalizeFsPath } from "@/lib/builderToWebContainerFiles";
import {
  prepareBuilderFilesForWebContainer,
  repairBuilderFilesFromViteLog,
  shouldRepairFromViteLog,
} from "@/lib/webcontainerPrepareBuilderFiles";
import { Button } from "@/components/ui/button";
import {
  destroyActiveContainer,
  getActiveProjectKey,
  isContainerReady,
  WebContainerManager,
  type ContainerPhase,
  type ManagerCallbacks,
} from "@/lib/webContainerManager";

type Props = {
  data: BuilderData;
  /** Notifica o painel pai do URL do dev server (para CTA «nova janela» no header). */
  onPreviewUrlChange?: (url: string | null) => void;
};

function phaseLabel(phase: ContainerPhase): string {
  switch (phase) {
    case "idle":      return "A iniciar…";
    case "booting":   return "A arrancar WebContainer…";
    case "mounting":  return "A montar ficheiros…";
    case "installing":return "A instalar dependências (npm)…";
    case "starting":  return "A iniciar servidor dev…";
    case "updating":  return "A aplicar alterações…";
    case "ready":     return "Preview activo";
    case "error":     return "Erro";
  }
}

function phaseDescription(phase: ContainerPhase): string {
  switch (phase) {
    case "idle":
    case "booting":   return "A arrancar o ambiente WebContainer…";
    case "mounting":  return "A montar ficheiros do projecto…";
    case "installing":return "A instalar dependências (npm install). Na primeira execução pode demorar vários minutos…";
    case "starting":  return "A iniciar o servidor Vite/Next e a aguardar o URL de preview…";
    case "updating":  return "A aplicar as alterações via HMR…";
    default:          return "A preparar…";
  }
}

function isLoadingPhase(phase: ContainerPhase): boolean {
  return phase !== "ready" && phase !== "error";
}

function projectKey(data: BuilderData): string {
  return `${data.title}:${data.project_type}`;
}

export function BuilderWebContainerPreview({ data, onPreviewUrlChange }: Props) {
  // ── Source files com patch opcional (repair PostCSS/Tailwind) ──────────────
  const [patchedFiles, setPatchedFiles] = useState<BuilderFile[] | null>(null);
  const [repairNonce, setRepairNonce] = useState(0);

  const dataFilesSig = useMemo(() => builderFilesSignature(data.files), [data.files]);
  useEffect(() => {
    setPatchedFiles(null);
  }, [dataFilesSig]);

  const sourceFiles = patchedFiles ?? data.files;
  const sourceSig = useMemo(() => builderFilesSignature(sourceFiles), [sourceFiles]);

  const preparedFiles = useMemo(
    () => prepareBuilderFilesForWebContainer(sourceFiles, { projectType: data.project_type }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceSig, data.project_type],
  );

  const pathsSorted = useMemo(() => {
    const p = preparedFiles.map((f) => normalizeFsPath(f.path)).filter(Boolean);
    p.sort((a, b) => a.localeCompare(b));
    return p;
  }, [preparedFiles]);

  // ── Estado do painel ───────────────────────────────────────────────────────
  const [phase, setPhase] = useState<ContainerPhase>("idle");
  const [log, setLog] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  /** true quando o último update foi um patch HMR (sem reload do iframe) */
  const [lastWasHmr, setLastWasHmr] = useState(false);
  const [liveEmbedHintDismissed, setLiveEmbedHintDismissed] = useState(false);

  const managerRef = useRef<WebContainerManager | null>(null);

  useEffect(() => {
    onPreviewUrlChange?.(previewUrl);
  }, [previewUrl, onPreviewUrlChange]);

  useEffect(() => {
    return () => onPreviewUrlChange?.(null);
  }, [onPreviewUrlChange]);

  useEffect(() => {
    setLiveEmbedHintDismissed(false);
  }, [data.title]);
  const appendLog = useCallback((chunk: string) => {
    setLog((prev) => (prev + chunk).slice(-32_000));
  }, []);

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  useEffect(() => {
    const key = projectKey(data);
    const files = preparedFiles;

    const callbacks: ManagerCallbacks = {
      onPhaseChange(p) {
        setPhase(p);
        if (p !== "error") setErrMsg(null);
        if (p === "updating") setLastWasHmr(false);
      },
      onLog(chunk) {
        appendLog(chunk);
        // Detectar HMR bem-sucedido no log
        if (chunk.includes("HMR:")) setLastWasHmr(true);
      },
      onReady(url) {
        setPreviewUrl(url);
      },
      onError(msg) {
        setErrMsg(msg);
        setPreviewUrl(null);
        setLastWasHmr(false);
      },
    };

    const mgr = new WebContainerManager(callbacks);
    managerRef.current = mgr;

    setErrMsg(null);

    const isUpdate = isContainerReady() && getActiveProjectKey() === key;

    if (!mgr.tryFastRestore(key, files)) {
      if (isUpdate) {
        // Container activo para o mesmo projecto → patch HMR (sem reiniciar)
        // Não limpa o log (preserva histórico)
        void mgr.updateFiles(files);
      } else {
        // Boot novo ou projecto diferente
        setLog("");
        setLastWasHmr(false);
        void mgr.init(files, key);
      }
    }

    return () => {
      // Desanexa callbacks — NÃO mata o servidor dev
      mgr.detach();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSig, data.title, data.project_type, repairNonce]);

  // ── Repair PostCSS/Tailwind ────────────────────────────────────────────────
  const handleRepair = useCallback(() => {
    const snap = log;
    if (!shouldRepairFromViteLog(snap)) return;
    setPatchedFiles((prev) => repairBuilderFilesFromViteLog(prev ?? data.files, snap));
    setRepairNonce((n) => n + 1);
    void destroyActiveContainer();
  }, [log, data.files]);

  // ── Reiniciar servidor ─────────────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    setLog("");
    setLastWasHmr(false);
    void managerRef.current?.restart();
  }, []);

  const canRepair = shouldRepairFromViteLog(log);
  const loading = isLoadingPhase(phase);

  const handleOpenLiveInNewWindow = useCallback(() => {
    if (!previewUrl) return;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }, [previewUrl]);

  return (
    <div className="flex h-full min-h-[min(52vh,520px)] w-full min-w-0 flex-1 flex-col gap-0 bg-background">
      {/* Barra de estado */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="size-3 animate-spin rounded-full border border-border border-t-primary" />
          ) : phase === "ready" ? (
            lastWasHmr ? (
              <Zap className="size-3 text-emerald-500" title="Actualizado via HMR" />
            ) : (
              <CheckCircle2 className="size-3 text-emerald-500" />
            )
          ) : phase === "error" ? (
            <AlertTriangle className="size-3 text-amber-500" />
          ) : null}
          <span className="font-medium text-foreground">{phaseLabel(phase)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canRepair ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              title="Corrige postcss.config e package.json com base no erro do Vite e reinicia"
              onClick={handleRepair}
            >
              <RefreshCw className="size-3" />
              Corrigir PostCSS/Tailwind
            </Button>
          ) : null}
          {phase === "ready" && previewUrl ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              title="Abre o preview numa aba nova (contorna iframe em branco por COEP ou WebView)"
              onClick={handleOpenLiveInNewWindow}
            >
              <ExternalLink className="size-3" />
              Nova janela
            </Button>
          ) : null}
          {phase === "ready" || phase === "error" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              title="Reinicia o servidor dev sem reinstalar dependências"
              onClick={handleRestart}
            >
              <RotateCcw className="size-3" />
              Reiniciar
            </Button>
          ) : null}
          {phase === "error" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-3" />
              Nova janela
            </Button>
          ) : null}
        </div>
      </div>

      {phase === "ready" && previewUrl && !liveEmbedHintDismissed ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1">
            Se o iframe acima estiver em branco (políticas do browser ou Electron), abra o preview ao vivo
            numa nova janela.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-[11px]"
            onClick={handleOpenLiveInNewWindow}
          >
            <ExternalLink className="size-3" />
            Abrir ao vivo (nova janela)
          </Button>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Fechar aviso"
            title="Fechar"
            onClick={() => setLiveEmbedHintDismissed(true)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Conteúdo principal */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 border-b border-border md:grid-cols-[minmax(160px,200px)_1fr]">
        {/* Coluna de ficheiros */}
        <aside className="flex min-h-0 flex-col border-border md:border-r">
          <div className="shrink-0 border-b border-border bg-muted/20 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Ficheiros ({pathsSorted.length})
          </div>
          <ul className="min-h-0 flex-1 list-none overflow-y-auto p-2 text-[11px] leading-relaxed">
            {pathsSorted.map((path) => {
              const depth = path.split("/").length - 1;
              return (
                <li
                  key={path}
                  className="flex items-center gap-1 truncate py-0.5 text-muted-foreground"
                  style={{ paddingLeft: 4 + Math.min(depth, 6) * 10 }}
                  title={path}
                >
                  <FileCode2 className="size-3 shrink-0 opacity-70" />
                  <span className="truncate">{path}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Coluna de preview */}
        <div className="relative flex min-h-[280px] min-w-0 flex-col bg-muted/10">
          {previewUrl ? (
            <>
              {/*
               * credentialless — bypassa COEP require-corp para o iframe de preview.
               * Obrigatório quando a página pai tem COEP:require-corp (necessário para
               * o WebContainer). Suportado em Chromium 110+ / Electron 24+.
               * Sem este atributo o browser bloqueia todos os recursos do Vite dev server
               * e o iframe fica em branco apesar do servidor estar a correr.
               *
               * allow="cross-origin-isolated" — permite que o iframe use SharedArrayBuffer
               * se necessário (ex. WASM). clipboard-* para copy/paste dentro do preview.
               */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <iframe
                key={previewUrl}
                title="Preview WebContainer"
                src={previewUrl}
                allow="cross-origin-isolated; clipboard-read; clipboard-write; camera; microphone; fullscreen"
                {...({ credentialless: "" } as any)}
                className="h-full min-h-[240px] w-full flex-1 border-0 bg-white"
              />
              {/* Overlay de actualização HMR (sem esconder o iframe) */}
              {phase === "updating" ? (
                <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-background/70 py-2 text-xs text-muted-foreground backdrop-blur-sm">
                  <div className="size-3 animate-spin rounded-full border border-border border-t-primary" />
                  A aplicar alterações…
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              {phase === "error" ? (
                <>
                  <AlertTriangle className="size-8 text-amber-500" />
                  <pre className="max-w-lg whitespace-pre-wrap text-left text-[11px] text-foreground">
                    {errMsg}
                  </pre>
                </>
              ) : (
                <>
                  <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                  <p>{phaseDescription(phase)}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Painel de registo */}
      {log.trim() &&
      (phase === "installing" ||
        phase === "starting" ||
        phase === "ready" ||
        phase === "updating" ||
        phase === "error") ? (
        <details
          className="shrink-0 border-t border-border bg-card/30"
          open={phase === "error"}
        >
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground select-none">
            Registo npm / Vite
          </summary>
          <pre className="max-h-52 overflow-auto px-3 pb-2 font-mono text-[10px] leading-snug text-muted-foreground">
            {log}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
