import { GitBranch } from "lucide-react";

/** Placeholder Flow Mode — layout apenas, zero lógica (DESK-13). */
export function FlowModeShell() {
  return (
    <section
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8 text-center"
      aria-label="Flow Mode"
    >
      <GitBranch className="size-8 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">Flow Mode</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Automações visuais chegam numa versão futura. Por agora use Agent Mode ou Code Mode.
      </p>
    </section>
  );
}
