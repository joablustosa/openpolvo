import { useCallback, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { APP_LABELS, getPluginUrl, type AppId } from "@/config/apps";
import { useWorkspace } from "@/core/WorkspaceContext";
import { Button } from "@/components/ui/button";
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
  const { activeApp } = useWorkspace();
  const webviewRef = useRef<HTMLWebViewElement | null>(null);
  const isElectron = isElectronShell();

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
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <p>Abra com Electron para embutir o site no painel.</p>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              Abrir {title} no navegador
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
