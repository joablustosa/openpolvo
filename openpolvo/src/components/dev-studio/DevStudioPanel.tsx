import { ExternalLink, FolderOpen, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktopPolvoCode, isElectron } from "@/lib/desktopApi";
import { isWebContainerSupported } from "@/lib/webcontainer/types";
import { useConversationWorkspaceOptional } from "@/core/ConversationWorkspaceContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { saveDevStudioConversationProject } from "@/lib/devStudio/conversationProjectLink";
import { DevStudioPreviewPane } from "./DevStudioPreviewPane";
import { useDevStudioRuntime } from "./useDevStudioRuntime";
import { cn } from "@/lib/utils";

type Props = {
  onClose: () => void;
};

export function DevStudioPanel({ onClose }: Props) {
  const conversationWorkspace = useConversationWorkspaceOptional();
  const {
    devStudioWorkspacePath,
    devStudioProjectTitle,
    devStudioPreviewGeneration,
    setDevStudioProject,
    clearDevStudio,
    openDevStudioPreview,
  } = useWorkspace();

  const workspacePath = devStudioWorkspacePath ?? "";
  const {
    devUrl,
    phase,
    statusLine,
    previewReloadKey,
    bumpPreview,
    startPreview,
    useWebContainer,
  } = useDevStudioRuntime(workspacePath, devStudioPreviewGeneration);

  const busy = phase === "applying" || phase === "installing" || phase === "starting";
  const inElectron = isElectron();
  const webContainerReady = isWebContainerSupported();
  const previewSurface = useWebContainer || !inElectron ? "iframe" : "webview";

  const handleChooseFolder = async () => {
    if (!inElectron) return;
    const r = await desktopPolvoCode.chooseProjectFolder();
    if (r.ok && "workspacePath" in r && r.workspacePath) {
      setDevStudioProject(r.workspacePath, null);
      openDevStudioPreview();
      const cid = conversationWorkspace?.activeConversationId;
      if (cid) {
        saveDevStudioConversationProject(cid, r.workspacePath, null);
      }
    }
  };

  const handleClose = async () => {
    if (useWebContainer) {
      const { getWebContainerPreviewService } = await import("@/lib/webcontainer");
      await getWebContainerPreviewService().teardown();
    } else if (inElectron) {
      void desktopPolvoCode.devStop();
    }
    clearDevStudio();
    onClose();
  };

  const handleOpenExternal = () => {
    if (devUrl && inElectron) void desktopPolvoCode.openExternal(devUrl);
    else if (devUrl) window.open(devUrl, "_blank", "noopener,noreferrer");
  };

  if (!inElectron && !webContainerReady) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium">Estúdio de desenvolvimento</p>
        <p className="max-w-md text-xs text-muted-foreground">
          O preview no browser requer Cross-Origin Isolation (headers COOP/COEP). Execute{" "}
          <code className="rounded bg-muted px-1">npm run dev:web</code> e recarregue a página,
          ou use a app desktop (Electron).
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label="Estúdio de desenvolvimento"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {devStudioProjectTitle?.trim() || "Preview do projecto"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {statusLine}
            {useWebContainer ? " · WebContainer" : inElectron ? " · local" : ""}
          </p>
        </div>
        {inElectron ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Escolher pasta"
            onClick={() => void handleChooseFolder()}
          >
            <FolderOpen className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Recarregar preview"
          disabled={!devUrl || busy}
          onClick={() => {
            bumpPreview();
            void startPreview();
          }}
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </Button>
        {devUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Abrir no browser"
            onClick={handleOpenExternal}
          >
            <ExternalLink className="size-4" />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" title="Fechar" onClick={() => void handleClose()}>
          <X className="size-4" />
        </Button>
      </header>

      <div
        data-dev-studio-preview
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <DevStudioPreviewPane
          devUrl={devUrl}
          running={busy}
          reloadKey={previewReloadKey}
          surface={previewSurface}
        />
        {busy ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background/90 px-4 py-2 shadow-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">{statusLine}</span>
            </div>
          </div>
        ) : null}
      </div>

      {!workspacePath ? (
        <footer className="shrink-0 border-t border-border/60 bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
          Peça no chat algo como «cria uma landing page» — o preview abre aqui automaticamente
          {useWebContainer || !inElectron ? " (no seu browser, via WebContainer)" : ""}.
        </footer>
      ) : null}
    </section>
  );
}
