import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Ordem alinhada com `zepolvinho` (analyze) + `run_builder_stream` (techlead→integrator). */
export const BUILDER_PIPELINE_STEPS = [
  "analyze",
  "techlead",
  "engineer",
  "developer",
  "integrator",
] as const;

export type BuilderPipelineStep = (typeof BUILDER_PIPELINE_STEPS)[number];

export function builderPipelineStepIndex(step: string): number {
  const i = (BUILDER_PIPELINE_STEPS as readonly string[]).indexOf(step);
  return i === -1 ? 0 : i;
}

export function builderPipelineStepShortLabel(step: string): string {
  switch (step) {
    case "analyze":
      return "Analisar";
    case "techlead":
      return "Stack";
    case "engineer":
      return "Estrutura";
    case "developer":
      return "Código";
    case "integrator":
      return "Integrar";
    default:
      return step;
  }
}

function builderPipelineStepFullLabel(step: string): string {
  switch (step) {
    case "analyze":
      return "A analisar o pedido…";
    case "techlead":
      return "Tech Lead a definir arquitetura…";
    case "engineer":
      return "Engenheiro a planear estrutura…";
    case "developer":
      return "Programador a gerar código…";
    case "integrator":
      return "Integrador a finalizar projecto…";
    default:
      return step;
  }
}

type Props = {
  progress: { step: string; label: string } | null;
  variant: "full" | "compact";
};

/**
 * Checklist dos nós do Builder (padrão tipo Claude Code / todos de sessão).
 */
export function BuilderProgressChecklist({ progress, variant }: Props) {
  const currentIndex = progress ? builderPipelineStepIndex(progress.step) : 0;

  if (variant === "compact") {
    return (
      <div
        className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-[11px]"
        role="status"
        aria-live="polite"
      >
        <p className="mb-1.5 font-medium text-foreground">A gerar aplicação</p>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-muted-foreground">
          {BUILDER_PIPELINE_STEPS.map((step, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <span key={step} className="inline-flex items-center gap-1">
                {i > 0 ? <span className="text-border">·</span> : null}
                <span
                  className={cn(
                    "rounded px-1 py-0.5",
                    done && "text-emerald-600 dark:text-emerald-400",
                    active && "bg-primary/12 font-semibold text-foreground",
                  )}
                >
                  {done ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Check className="size-3" aria-hidden />
                      {builderPipelineStepShortLabel(step)}
                    </span>
                  ) : active && progress ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin shrink-0" aria-hidden />
                      {builderPipelineStepShortLabel(step)}
                    </span>
                  ) : (
                    builderPipelineStepShortLabel(step)
                  )}
                </span>
              </span>
            );
          })}
        </div>
        {progress ? (
          <p className="mt-1.5 line-clamp-2 text-muted-foreground">{progress.label}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {BUILDER_PIPELINE_STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
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
              {done ? "✓" : i + 1}
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
              {active && progress ? progress.label : builderPipelineStepFullLabel(step)}
            </span>
            {active ? <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden /> : null}
          </div>
        );
      })}
    </div>
  );
}
