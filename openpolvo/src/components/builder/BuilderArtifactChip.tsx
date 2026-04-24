/**
 * Chip de artefacto Builder — aparece em cada mensagem do assistente que criou
 * ou modificou ficheiros do projecto (padrão Claude / Lovable).
 *
 * Ao clicar, restaura o snapshot desse turno no painel lateral.
 * Mostra um diff compacto (+adicionados ~modificados -removidos) em relação
 * ao turno de Builder anterior.
 */
import { FileCode2, Package, RotateCcw } from "lucide-react";
import type { BuilderData } from "@/lib/builderMetadata";
import type { FileDiff } from "@/lib/builderDiff";

// Re-exporta para conveniência dos consumidores que só importam daqui
export type { FileDiff };
export { computeBuilderDiff } from "@/lib/builderDiff";

type Props = {
  data: BuilderData;
  /** Diferença em relação ao turno de Builder anterior (null = primeira criação). */
  diff: FileDiff | null;
  /** True se este é o snapshot mais recente (turno actual). */
  isLatest: boolean;
  onClick: () => void;
};

// ─── Componente ────────────────────────────────────────────────────────────────

export function BuilderArtifactChip({ data, diff, isLatest, onClick }: Props) {
  const isCreation = diff === null || (diff.added > 0 && diff.changed === 0 && diff.removed === 0 && diff.added === data.files.length);
  const hasDiff = diff && (diff.added > 0 || diff.changed > 0 || diff.removed > 0) && !isCreation;

  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2.5 flex w-full max-w-[320px] items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-left text-xs transition-all hover:border-primary/40 hover:bg-card hover:shadow-sm active:scale-[0.98]"
      title={isLatest ? `Ver projecto "${data.title}"` : `Restaurar snapshot "${data.title}" deste turno`}
    >
      {/* Ícone */}
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Package className="size-4 text-primary" />
      </div>

      {/* Conteúdo */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground leading-tight">{data.title}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
          <FileCode2 className="size-3 shrink-0" />
          <span>
            {isCreation
              ? `${data.files.length} ficheiro${data.files.length !== 1 ? "s" : ""} criado${data.files.length !== 1 ? "s" : ""}`
              : `${data.files.length} ficheiro${data.files.length !== 1 ? "s" : ""}`}
          </span>
          {hasDiff && diff ? (
            <span className="flex items-center gap-0.5">
              {diff.added > 0 ? (
                <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  +{diff.added}
                </span>
              ) : null}
              {diff.changed > 0 ? (
                <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  ~{diff.changed}
                </span>
              ) : null}
              {diff.removed > 0 ? (
                <span className="rounded bg-red-500/10 px-1 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                  -{diff.removed}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* Estado */}
      {isLatest ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          actual
        </span>
      ) : (
        <RotateCcw
          className="size-3.5 shrink-0 text-muted-foreground/60"
          aria-label="Restaurar esta versão"
        />
      )}
    </button>
  );
}
