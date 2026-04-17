import { useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, FileCode, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BuilderData } from "@/lib/builderMetadata";
import { projectTypeLabel } from "@/lib/builderMetadata";
import { BuilderPreview } from "./BuilderPreview";
import { BuilderCodeView } from "./BuilderCodeView";
import { cn } from "@/lib/utils";

type Props = {
  data: BuilderData;
  onClose: () => void;
};

function projectTypeBadgeClasses(t: BuilderData["project_type"]): string {
  switch (t) {
    case "fullstack_node":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "fullstack_go_hexagonal":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "frontend_only":
    default:
      return "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20";
  }
}

export function BuilderPanel({ data, onClose }: Props) {
  const [deployOpen, setDeployOpen] = useState(false);
  const hasPreview = typeof data.preview_html === "string" && data.preview_html.trim().length > 0;
  const hasFiles = data.files.length > 0;
  const defaultTab = hasPreview ? "preview" : "code";
  const review = data.review_summary;

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
      aria-label="Aplicação gerada"
    >
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <Package className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.title}</span>
        <Badge
          variant="outline"
          className={cn("ml-1 border px-2 py-0.5 text-[10px] font-medium", projectTypeBadgeClasses(data.project_type))}
        >
          {projectTypeLabel(data.project_type)}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Fechar painel"
            title="Fechar"
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        defaultValue={defaultTab}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/40 px-3 py-2">
          <TabsList>
            <TabsTrigger value="preview">
              <Eye className="size-3.5" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="code">
              <FileCode className="size-3.5" />
              Código
              {hasFiles ? (
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {data.files.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
          {data.framework ? (
            <span className="hidden truncate text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
              {data.framework}
            </span>
          ) : null}
        </div>

        <TabsContent value="preview" className="relative min-h-0 flex-1 overflow-hidden">
          <BuilderPreview data={data} />
        </TabsContent>
        <TabsContent value="code" className="min-h-0 flex-1 overflow-hidden">
          <BuilderCodeView files={data.files} entryFile={data.entry_file} />
        </TabsContent>
      </Tabs>

      {/* Rodapé */}
      {review || data.deploy_instructions ? (
        <footer className="shrink-0 border-t border-border bg-card/60 px-3 py-2 text-xs">
          {review ? (
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1">
                {review.tests_ok ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="size-3.5 text-amber-500" />
                )}
                {review.tests_ok ? "testes OK" : "testes com avisos"}
              </span>
              <span>·</span>
              <span>{review.issues_fixed} correcções aplicadas</span>
              {review.remaining_warnings.length > 0 ? (
                <>
                  <span>·</span>
                  <span
                    title={review.remaining_warnings.join("\n")}
                    className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                  >
                    <AlertTriangle className="size-3.5" />
                    {review.remaining_warnings.length} aviso{review.remaining_warnings.length === 1 ? "" : "s"}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          {data.deploy_instructions ? (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setDeployOpen((v) => !v)}
                className="text-xs font-medium text-foreground hover:underline"
              >
                {deployOpen ? "Ocultar" : "Ver"} instruções de execução
              </button>
              {deployOpen ? (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {data.deploy_instructions}
                </pre>
              ) : null}
            </div>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
