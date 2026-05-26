import { useEffect, useRef, type CSSProperties } from "react";
import { DEV_STUDIO_WEBVIEW_PARTITION } from "@/modules/dev-studio/config";

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
};

const PREVIEW_SURFACE_CLASS =
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background";

const PREVIEW_MEDIA_STYLE: CSSProperties = {
  display: "block",
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: "100%",
  height: "100%",
  border: "none",
};

export function DevStudioPreviewPane({
  devUrl,
  running,
  reloadKey,
  surface = "webview",
}: Props) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);

  useEffect(() => {
    if (surface !== "webview") return;
    const el = webviewRef.current;
    if (!el || !devUrl) return;
    try {
      if (el.src !== devUrl) el.src = devUrl;
    } catch {
      el.src = devUrl;
    }
  }, [devUrl, reloadKey, surface]);

  useEffect(() => {
    if (surface !== "webview") return;
    const el = webviewRef.current;
    if (!el) return;
    Object.assign(el.style, PREVIEW_MEDIA_STYLE);
  }, [surface, devUrl, reloadKey]);

  if (!devUrl) {
    return (
      <div className={PREVIEW_SURFACE_CLASS}>
        <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
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
      <div className={PREVIEW_SURFACE_CLASS}>
        <iframe
          key={`${devUrl}-${reloadKey}`}
          title="Preview Open Polvo"
          src={devUrl}
          style={PREVIEW_MEDIA_STYLE}
          allow="cross-origin-isolated; clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    );
  }

  return (
    <div className={PREVIEW_SURFACE_CLASS}>
      {/* eslint-disable-next-line react/no-unknown-property -- webview Electron */}
      <webview
        key={`${devUrl}-${reloadKey}`}
        ref={webviewRef as React.RefObject<HTMLElement>}
        src={devUrl}
        partition={DEV_STUDIO_WEBVIEW_PARTITION}
        allowpopups="true"
        webpreferences="contextIsolation=yes, javascript=yes"
        style={PREVIEW_MEDIA_STYLE}
      />
    </div>
  );
}
