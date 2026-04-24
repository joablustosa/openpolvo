import { FileCode, Loader2, Package } from "lucide-react";
import type { BuilderFile } from "@/lib/builderMetadata";
import { BuilderProgressChecklist } from "@/components/builder/BuilderProgressChecklist";

type Props = {
  progress: { step: string; label: string } | null;
  files: BuilderFile[];
};

export function BuilderStreamingPanel({ progress, files }: Props) {
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <Package className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">A construir aplicação…</span>
        <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" aria-hidden />
      </header>

      {/* Progresso */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        <BuilderProgressChecklist progress={progress} variant="full" />

        {/* Ficheiros recebidos */}
        {files.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Ficheiros gerados ({files.length})
            </p>
            <ul className="space-y-1">
              {files.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs"
                >
                  <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                  <span className="shrink-0 text-muted-foreground">{f.language}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
