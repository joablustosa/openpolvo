import { DEV_STUDIO_WEBVIEW_PARTITION } from "@/modules/dev-studio/config";
import { cn } from "@/lib/utils";
import { usePreviewSurfaceFill } from "./usePreviewSurfaceFill";

type ElectronWebviewElement = HTMLElement & {
  src: string;
  reload?: () => void;
};

type Props = {
  devUrl: string;
  running: boolean;
  reloadKey: number;
  /** Browser: iframe com URL do WebContainer; Electron: webview local. */
  surface?: "iframe" | "webview";
  className?: string;
};

/** Preenche o slot `absolute inset-0` dentro de `[data-dev-studio-preview]`. */
const PREVIEW_HOST_CLASS =
  "absolute inset-0 min-h-0 min-w-0 overflow-hidden bg-background";

export function DevStudioPreviewPane({
  devUrl,
  running,
  reloadKey,
  surface = "webview",
  className,
}: Props) {
  const { containerRef, mediaRef, syncSize } = usePreviewSurfaceFill([
    devUrl,
    reloadKey,
    surface,
  ]);

  const hostClass = cn(PREVIEW_HOST_CLASS, className);

  if (!devUrl) {
    return (
      <div ref={containerRef} className={hostClass}>
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium text-foreground">Preview</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {running
              ? "A iniciar o servidor de desenvolvimento…"
              : "Peça no chat para criar ou alterar um site — o resultado aparece aqui, não no chat."}
          </p>
        </div>
      </div>
    );
  }

  if (surface === "iframe") {
    return (
      <div ref={containerRef} className={hostClass}>
        <iframe
          key={`${devUrl}-${reloadKey}`}
          ref={(el) => {
            mediaRef.current = el;
            syncSize();
          }}
          title="Preview Open Polvo"
          src={devUrl}
          allow="cross-origin-isolated; clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={hostClass}>
      {/* eslint-disable-next-line react/no-unknown-property -- webview Electron */}
      <webview
        key={`${devUrl}-${reloadKey}`}
        ref={(el) => {
          mediaRef.current = el as ElectronWebviewElement | null;
          if (devUrl && el) {
            const wv = el as ElectronWebviewElement;
            try {
              if (wv.src !== devUrl) wv.src = devUrl;
            } catch {
              wv.src = devUrl;
            }
          }
          syncSize();
        }}
        src={devUrl}
        partition={DEV_STUDIO_WEBVIEW_PARTITION}
        allowpopups={true}
        webpreferences="contextIsolation=yes, javascript=yes"
      />
    </div>
  );
}
