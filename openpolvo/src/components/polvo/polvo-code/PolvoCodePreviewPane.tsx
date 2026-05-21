import { Loader2 } from "lucide-react";
import { isElectron } from "@/lib/desktopApi";

/** `<webview>` do Electron (guest process); tipagem mínima alinhada a `SitePanel`. */
export type PolvoPreviewWebviewElement = HTMLElement & {
  src: string;
  reload?: () => void;
};

type Props = {
  devUrl: string | null;
  running: boolean;
  /** Incrementar para forçar remount / recarga do guest. */
  reloadKey: number;
};

/**
 * Preview do Vite embutido via `<webview>` (não `<iframe>`).
 * O iframe na shell Electron falha com X-Frame-Options / isolamento do servidor de dev;
 * o webview é o padrão já usado em `SitePanel` para conteúdo embutido.
 */
export function PolvoCodePreviewPane({ devUrl, running, reloadKey }: Props) {
  if (!isElectron()) return null;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#0a0a0a]">
      {devUrl ? (
        <webview
          key={`${devUrl}#${reloadKey}`}
          src={devUrl}
          partition="persist:polvo-code-vite-preview"
          allowpopups={true}
          className="block min-h-0 w-full flex-1 border-0 bg-white"
          style={{ minHeight: 0 }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-[#969696]">
          <p>Arranca o servidor dev para ver o preview aqui.</p>
          {running ? (
            <Loader2 className="size-6 shrink-0 animate-spin text-[#969696]" aria-hidden />
          ) : null}
        </div>
      )}
    </div>
  );
}
