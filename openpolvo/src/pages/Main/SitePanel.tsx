import { useCallback, useEffect, useRef } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { APP_LABELS, getPluginUrl, type AppId } from "@/config/apps";
import { useWorkspace } from "@/core/WorkspaceContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel";
import { BuilderPanel } from "@/components/builder/BuilderPanel";
import { BuilderStreamingPanel } from "@/components/builder/BuilderStreamingPanel";
import { TaskListsWorkspaceBody } from "@/pages/AgenteTarefas/TaskListsWorkspaceBody";
import { getDesktopDownloadUrl } from "@/lib/desktopDownload";
import { cn } from "@/lib/utils";

function isElectronShell(): boolean {
  if (typeof window === "undefined") return false;
  if (window.smartagent?.isElectron) return true;
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Electron")
  );
}

function panelSubtitle(app: AppId, url: string): string {
  if (app === "smartbus") return "pré-produção";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function SitePanel() {
  const { targetUrl, token } = useAuth();
  const {
    activeApp,
    dashboardData, setDashboardData,
    builderData, setBuilderData,
    builderProgress, builderStreamFiles,
    taskListsPreviewOpen,
    taskListsPreviewNonce,
    closeTaskListsPreview,
    refreshTaskListsPreview,
  } = useWorkspace();
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  const isElectron = isElectronShell();
  const desktopDownloadUrl = getDesktopDownloadUrl();

  const defaultUrl =
    activeApp != null ? getPluginUrl(activeApp) : "";
  const src = (targetUrl || defaultUrl).trim();

  const reload = useCallback(() => {
    const w = webviewRef.current;
    if (w?.reload) w.reload();
    else if (w) w.src = src;
  }, [src]);

  useEffect(() => {
    if (!isElectron) return;
    const webview = webviewRef.current;
    if (!webview) return;

    // Força o webview a ocupar 100% do viewport.
    // O sizing "em px" pode ficar curto em alguns layouts (grid/flex + redimensionamento),
    // causando a faixa preta (conteúdo cortado).
    webview.style.display = "block";
    webview.style.position = "absolute";
    webview.style.inset = "0";
    webview.style.width = "100%";
    webview.style.height = "100%";
  }, [isElectron, src]);

  useEffect(() => {
    if (!isElectron || !src) return;
    const el = webviewRef.current;
    if (!el) return;
    try {
      const cur = typeof el.getURL === "function" ? el.getURL() : el.src;
      if (cur !== src) el.src = src;
    } catch {
      el.src = src;
    }
  }, [isElectron, src]);

  // Builder (Lovable-like) tem prioridade máxima
  if (builderData) {
    return <BuilderPanel data={builderData} onClose={() => setBuilderData(null)} />;
  }

  // Painel de progresso durante o stream do Builder
  if (builderProgress || builderStreamFiles.length > 0) {
    return (
      <BuilderStreamingPanel
        progress={builderProgress}
        files={builderStreamFiles}
      />
    );
  }

  // Dashboard tem prioridade sobre plugin nativo
  if (dashboardData) {
    return <DashboardPanel data={dashboardData} onClose={() => setDashboardData(null)} />;
  }

  // Listas de tarefas — barra mínima (logo/menu ficam no AgentHomeHeader da MainPage)
  if (taskListsPreviewOpen) {
    return (
      <section
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-muted/20"
        aria-label="Listas de tarefas"
      >
        <header className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b border-border/60 bg-background/90 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            onClick={() => refreshTaskListsPreview()}
            title="Recarregar listas"
            aria-label="Recarregar listas"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            onClick={() => closeTaskListsPreview()}
            title="Fechar painel de listas"
            aria-label="Fechar painel de listas"
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <TaskListsWorkspaceBody refreshKey={taskListsPreviewNonce} />
        </div>
      </section>
    );
  }

  if (!activeApp) return null;

  const app = activeApp;
  const title = APP_LABELS[app];
  const subtitle = panelSubtitle(app, src);

  return (
    <section
      className={cn(
        // Flex é mais previsível que grid para o <webview> (Electron) ocupar 100% da altura.
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-muted/30",
      )}
      aria-label="Sistema integrado"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={reload}
            title="Recarregar"
            aria-label="Recarregar página"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      {token ? (
        <p className="h-7 shrink-0 truncate border-b border-border px-3 text-[10px] leading-7 text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
            smartagent_auth_token
          </code>{" "}
          definido
        </p>
      ) : null}

      <div
        className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-background"
      >
        {isElectron ? (
          <webview
            key={src}
            ref={(el) => {
              webviewRef.current = el;
            }}
            src={src}
            partition="persist:smartagent"
            allowpopups="true"
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="max-w-sm space-y-2 text-sm text-muted-foreground">
              <p>
                O painel de <span className="font-medium text-foreground">{title}</span>{" "}
                corre na aplicação <span className="font-medium text-foreground">desktop</span>{" "}
                (Electron), com o site embutido ao lado do chat.
              </p>
              <p className="text-xs leading-relaxed">
                Na versão web não é possível mostrar o plugin aqui; instale a versão desktop para
                usar esta integração.
              </p>
            </div>
            {desktopDownloadUrl ? (
              <a
                href={desktopDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "default", size: "lg" }),
                  "gap-2 no-underline",
                )}
              >
                <Download className="size-4" />
                Baixar versão desktop
              </a>
            ) : (
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Para mostrar o botão de download nesta página, defina{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  VITE_DESKTOP_DOWNLOAD_URL
                </code>{" "}
                no ambiente do Vite antes do build (ver{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">.env.example</code>
                ).
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
