import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DevWorkflowEditMode, EnrichedBrief } from "@/lib/devStudioMetadata";

type Props = {
  brief: EnrichedBrief;
  editMode?: DevWorkflowEditMode | null;
  className?: string;
};

function editModeLabel(mode: DevWorkflowEditMode | null | undefined): string | null {
  const m = (mode || "").trim();
  if (!m) return null;
  if (m === "diff_patch") return "Modificação (patch)";
  if (m === "create") return "Criação";
  if (m === "modify") return "Modificação";
  if (m === "mixed") return "Misto";
  return m;
}

export function EnrichedBriefBlock({ brief, editMode, className }: Props) {
  const modeLabel = editModeLabel(editMode);
  return (
    <div
      className={cn(
        "mt-2 rounded-xl border border-border/70 bg-muted/20 p-3",
        className,
      )}
      aria-label="Brief do pedido"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium tracking-tight text-foreground">
          Brief
        </span>
        {modeLabel ? <Badge variant="secondary">{modeLabel}</Badge> : null}
        {brief.layout_shell ? (
          <Badge variant="outline">{String(brief.layout_shell)}</Badge>
        ) : null}
        {brief.palette_hint ? (
          <Badge variant="outline">{String(brief.palette_hint)}</Badge>
        ) : null}
      </div>

      {brief.objective ? (
        <p className="mt-2 text-xs leading-relaxed text-foreground">
          <span className="font-medium">Objectivo:</span>{" "}
          <span className="text-muted-foreground">{brief.objective}</span>
        </p>
      ) : null}

      {brief.audience ? (
        <p className="mt-1 text-xs leading-relaxed text-foreground">
          <span className="font-medium">Público:</span>{" "}
          <span className="text-muted-foreground">{brief.audience}</span>
        </p>
      ) : null}

      {brief.tone ? (
        <p className="mt-1 text-xs leading-relaxed text-foreground">
          <span className="font-medium">Tom:</span>{" "}
          <span className="text-muted-foreground">{brief.tone}</span>
        </p>
      ) : null}

      {brief.sections?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {brief.sections.map((s) => (
            <Badge key={s} variant="outline" className="bg-background/40">
              {s}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

