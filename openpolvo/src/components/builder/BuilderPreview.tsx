import { useMemo } from "react";
import type { BuilderData } from "@/lib/builderMetadata";

type Props = {
  data: BuilderData;
};

/**
 * Renderiza o `preview_html` num iframe isolado. Usa `srcdoc` + `sandbox`.
 * Se o HTML vier vazio, mostra um fallback amigável.
 */
export function BuilderPreview({ data }: Props) {
  const html = data.preview_html;
  const hasPreview = typeof html === "string" && html.trim().length > 0;

  // Evita recriar o iframe em cada render (preservar estado da aplicação).
  const iframeKey = useMemo(() => `${data.title}:${html.length}`, [data.title, html.length]);

  if (!hasPreview) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <div className="max-w-sm space-y-2">
          <p className="font-medium text-foreground">Preview indisponível</p>
          <p className="text-xs">
            O integrador não produziu um HTML de pré-visualização. Abre o separador
            <span className="mx-1 font-medium text-foreground">Código</span>
            para ver os ficheiros gerados.
          </p>
        </div>
      </div>
    );
  }

  const looksLikeHtmlFragment =
    !/<\s*html[\s>]/i.test(html) && !/<\s*script/i.test(html) && html.length < 4000;

  return (
    <div className="flex h-full min-h-[min(40vh,360px)] min-h-0 w-full flex-1 flex-col">
      {looksLikeHtmlFragment ? (
        <p className="shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          Este HTML parece um fragmento (sem{" "}
          <code className="rounded bg-background px-1">&lt;script&gt;</code> nem documento completo), por isso o
          iframe pode ficar em branco. Prefere{" "}
          <strong className="text-foreground">Visualizar → Pré-visualização ao vivo (npm)</strong> quando o
          projecto tiver Vite/React.
        </p>
      ) : null}
      <iframe
        key={iframeKey}
        title={`Preview: ${data.title}`}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
