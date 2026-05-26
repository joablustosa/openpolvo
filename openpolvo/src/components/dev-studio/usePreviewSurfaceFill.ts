import { useCallback, useEffect, useRef } from "react";

type MediaEl = HTMLElement;

const MIN_HOST_HEIGHT_PX = 64;

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
    const t = window.setTimeout(syncSize, 120);
    const ro = new ResizeObserver(() => syncSize());
    ro.observe(container);
    window.addEventListener("resize", syncSize);

    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync quando URL/recarrega
  }, [syncSize, ...deps]);

  return { containerRef, mediaRef, syncSize };
}
