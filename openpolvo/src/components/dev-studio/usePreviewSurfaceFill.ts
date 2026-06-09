import { useCallback, useEffect, useRef } from "react";

type MediaEl = HTMLElement;

const MIN_HOST_HEIGHT_PX = 32;

/**
 * Electron <webview> e iframes não herdam bem height:100% em cadeias flex.
 * Observa o contentor (já com altura real) e fixa o surface em px.
 */
export function usePreviewSurfaceFill(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaEl | null>(null);

  const syncSize = useCallback(() => {
    const container = containerRef.current;
    const media = mediaRef.current;
    if (!container || !media) return;

    const { width, height } = container.getBoundingClientRect();
    const w = Math.max(0, Math.floor(width));
    const h = Math.max(0, Math.floor(height));
    if (w < 4 || h < MIN_HOST_HEIGHT_PX) return;

    media.style.display = "block";
    media.style.position = "absolute";
    media.style.top = "0";
    media.style.left = "0";
    media.style.width = `${w}px`;
    media.style.height = `${h}px`;
    media.style.border = "none";
    media.style.maxWidth = "none";
    media.style.maxHeight = "none";
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    syncSize();
    const raf1 = requestAnimationFrame(() => {
      syncSize();
      requestAnimationFrame(syncSize);
    });

    // Re-sincroniza durante os primeiros segundos: cobre o webview/iframe que
    // anexa tarde ou só ganha altura depois do dom-ready da página gerada.
    const timeouts = [80, 200, 400, 800, 1500, 2500].map((ms) =>
      window.setTimeout(syncSize, ms),
    );

    const ro = new ResizeObserver(() => syncSize());
    ro.observe(container);
    window.addEventListener("resize", syncSize);

    // Electron webview: re-sincroniza quando o conteúdo termina de carregar.
    const media = mediaRef.current;
    const onDomReady = () => syncSize();
    if (media && media.tagName.toLowerCase() === "webview") {
      media.addEventListener("dom-ready", onDomReady);
      media.addEventListener("did-finish-load", onDomReady);
    } else if (media && media.tagName.toLowerCase() === "iframe") {
      media.addEventListener("load", onDomReady);
    }

    return () => {
      cancelAnimationFrame(raf1);
      timeouts.forEach((t) => window.clearTimeout(t));
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
      if (media) {
        media.removeEventListener("dom-ready", onDomReady);
        media.removeEventListener("did-finish-load", onDomReady);
        media.removeEventListener("load", onDomReady);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync quando URL/recarrega
  }, [syncSize, ...deps]);

  return { containerRef, mediaRef, syncSize };
}
