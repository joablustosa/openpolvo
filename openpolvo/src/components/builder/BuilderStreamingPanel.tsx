import { FileCode, Loader2, Package } from "lucide-react";
import type { BuilderFile } from "@/lib/builderMetadata";

type Props = {
  progress: { step: string; label: string } | null;
  files: BuilderFile[];
};

const STEP_ORDER = ["analyze", "techlead", "engineer", "developer", "integrator"];

function stepIndex(step: string): number {
  const i = STEP_ORDER.indexOf(step);
  return i === -1 ? 0 : i;
}

export function BuilderStreamingPanel({ progress, files }: Props) {
  const currentIndex = progress ? stepIndex(progress.step) : 0;

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <Package className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">A construir aplicação…</span>
        <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
      </header>

      {/* Progresso */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        {/* Etapas */}
        <div className="space-y-2">
          {STEP_ORDER.slice(1).map((step, idx) => {
            const done = idx + 1 < currentIndex;
            const active = idx + 1 === currentIndex;
            return (
              <div key={step} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    done
                      ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold"
                      : active
                      ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold"
                      : "flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground text-[10px]"
                  }
                >
                  {done ? "✓" : idx + 1}
                </span>
                <span
                  className={
                    done
                      ? "text-muted-foreground line-through"
                      : active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {active && progress ? progress.label : stepLabel(step)}
                </span>
                {active && <Loader2 className="size-3.5 animate-spin text-primary" />}
              </div>
            );
          })}
        </div>

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

function stepLabel(step: string): string {
  switch (step) {
    case "techlead": return "Tech Lead a definir arquitetura...";
    case "engineer": return "Engenheiro a planear estrutura...";
    case "developer": return "Programador a gerar código...";
    case "integrator": return "Integrador a finalizar projecto...";
    default: return step;
  }
}
