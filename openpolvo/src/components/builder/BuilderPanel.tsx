import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode,
  Lightbulb,
  Package,
  Play,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BuilderData, BuilderProjectType } from "@/lib/builderMetadata";
import { projectTypeLabel } from "@/lib/builderMetadata";
import { computeBuilderDiff, computeBuilderPathSets, type FileDiff } from "@/lib/builderDiff";
import { builderFilesSignature, hasPackageJson } from "@/lib/builderToWebContainerFiles";
import {
  explainWebContainerPrepareFailure,
  prepareBuilderFilesForWebContainer,
} from "@/lib/webcontainerPrepareBuilderFiles";
import { BuilderCodeView } from "./BuilderCodeView";
import { BuilderWebContainerPreview } from "./BuilderWebContainerPreview";
import { cn } from "@/lib/utils";

type Props = {
  data: BuilderData;
  onClose: () => void;
};

function projectTypeBadgeClasses(t: BuilderProjectType): string {
  switch (t) {
    case "landing_page":
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    case "fullstack_node":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "fullstack_next":
      return "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20";
    case "fullstack_go_hexagonal":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "frontend_only":
    default:
      return "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20";
  }
}

function slugify(s: string): string {
  return (s || "projecto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "projecto";
}

/**
 * Painel Builder: um único preview funcional — WebContainer (Vite/npm), como IDE + dev server.
 * Compatível com browser e Electron (iframe credentialless + nova janela).
 */
export function BuilderPanel({ data, onClose }: Props) {
  const prevDataRef = useRef<BuilderData | null>(null);
  const [updateDiff, setUpdateDiff] = useState<FileDiff | null>(null);
  const [addedPaths, setAddedPaths] = useState<ReadonlySet<string>>(new Set());
  const [changedPaths, setChangedPaths] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const prev = prevDataRef.current;
    prevDataRef.current = data;
    if (!prev) return;
    const diff = computeBuilderDiff(prev, data);
    const hasChange = diff.added > 0 || diff.changed > 0 || diff.removed > 0;
    if (hasChange) {
      const pathSets = computeBuilderPathSets(prev, data);
      setAddedPaths(pathSets?.added ?? new Set());
      setChangedPaths(pathSets?.changed ?? new Set());
      setUpdateDiff(diff);
      const t = window.setTimeout(() => {
        setUpdateDiff(null);
        setAddedPaths(new Set());
        setChangedPaths(new Set());
      }, 8_000);
      return () => clearTimeout(t);
    }
  }, [data]);

  const filesSignature = useMemo(() => builderFilesSignature(data.files), [data.files]);
  const preparedForWebContainer = useMemo(
    () =>
      prepareBuilderFilesForWebContainer(data.files, {
        projectType: data.project_type,
      }),
    [filesSignature, data.project_type],
  );
  const canWebContainerPreview = hasPackageJson(preparedForWebContainer);
  const webContainerExplain = useMemo(
    () =>
      canWebContainerPreview
        ? ""
        : explainWebContainerPrepareFailure(
            data.files,
            preparedForWebContainer,
            data.project_type,
          ),
    [canWebContainerPreview, data.files, preparedForWebContainer, data.project_type],
  );
  const dataForWebContainer = useMemo(
    () => ({ ...data, files: preparedForWebContainer }),
    [data, preparedForWebContainer],
  );

  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const hasFiles = data.files.length > 0;
  const [tab, setTab] = useState<"app" | "code">("app");
  const review = data.review_summary;
  const hasRecs = !!(data.recommendations && data.recommendations.length > 0);

  useEffect(() => {
    setTab("app");
  }, [data.title, filesSignature]);

  const handleDownload = async () => {
    if (!hasFiles) return;
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const f of data.files) {
        zip.file(f.path, f.content);
      }
      const info = [
        `# ${data.title}`,
        "",
        data.description || "",
        "",
        `**Stack**: ${projectTypeLabel(data.project_type)}${data.framework ? ` · ${data.framework}` : ""}`,
        "",
        data.deploy_instructions ? data.deploy_instructions : "Correr: `npm install` e `npm run dev` (ver README.md).",
      ].join("\n");
      zip.file("INFO.md", info);
      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${slugify(data.title)}.zip`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
      aria-label="Aplicação gerada"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <Package className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.title}</span>
        <Badge
          variant="outline"
          className={cn("ml-1 border px-2 py-0.5 text-[10px] font-medium", projectTypeBadgeClasses(data.project_type))}
        >
          {projectTypeLabel(data.project_type)}
        </Badge>
        {hasRecs ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-1 h-7 gap-1 px-2 text-xs"
            onClick={() => setRecsOpen((v) => !v)}
            title="Ver alternativas recomendadas"
          >
            <Lightbulb className="size-3.5" />
            Alternativas
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {canWebContainerPreview && livePreviewUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              title="Abre o URL do Vite numa aba nova (recomendado no Electron se o iframe estiver em branco)"
              onClick={() =>
                window.open(livePreviewUrl, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink className="size-3.5" />
              Abrir em nova janela
            </Button>
          ) : null}
          {hasFiles ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="h-8 gap-1.5 px-2.5 text-xs"
              title="Descarregar projecto em ZIP"
            >
              <Download className="size-3.5" />
              {downloading ? "A empacotar…" : "Descarregar"}
            </Button>
          ) : null}
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

      {hasRecs && recsOpen ? (
        <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3 text-xs">
          {data.recommendation_reason ? (
            <p className="mb-2 flex items-start gap-1.5 text-foreground">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Porquê {projectTypeLabel(data.project_type)}:</span>{" "}
                {data.recommendation_reason}
              </span>
            </p>
          ) : null}
          <p className="mb-1.5 font-medium text-muted-foreground">Alternativas a considerar:</p>
          <ul className="space-y-1.5">
            {data.recommendations!.map((r) => (
              <li key={r.project_type} className="flex items-start gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 border px-1.5 py-0.5 text-[10px] font-medium",
                    projectTypeBadgeClasses(r.project_type),
                  )}
                >
                  {projectTypeLabel(r.project_type)}
                </Badge>
                <span className="text-muted-foreground">{r.tradeoff}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canWebContainerPreview ? (
        <p className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
          {webContainerExplain ||
            "Sem package.json reconhecido: o preview ao vivo (Vite) não arranca neste painel. Descarrega o ZIP e corre npm install && npm run dev no teu ambiente."}
        </p>
      ) : null}

      {updateDiff ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <Zap className="size-3.5 shrink-0 text-emerald-500" />
          <span className="font-medium">Actualizado via HMR</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {updateDiff.added > 0 && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                +{updateDiff.added}
              </span>
            )}
            {updateDiff.changed > 0 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                ~{updateDiff.changed}
              </span>
            )}
            {updateDiff.removed > 0 && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-700 dark:text-red-400">
                -{updateDiff.removed}
              </span>
            )}
            <span>ficheiro{(updateDiff.added + updateDiff.changed + updateDiff.removed) !== 1 ? "s" : ""}</span>
          </span>
          <button
            type="button"
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => setUpdateDiff(null)}
            aria-label="Fechar"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}

      {canWebContainerPreview ? (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "app" | "code")}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/40 px-3 py-2">
            <TabsList>
              <TabsTrigger value="app" className="gap-1.5">
                <Play className="size-3.5" />
                App ao vivo
              </TabsTrigger>
              <TabsTrigger value="code" className="gap-1.5">
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
          <TabsContent value="app" className="relative min-h-0 flex-1 overflow-hidden">
            <BuilderWebContainerPreview
              data={dataForWebContainer}
              onPreviewUrlChange={setLivePreviewUrl}
            />
          </TabsContent>
          <TabsContent value="code" className="min-h-0 flex-1 overflow-hidden">
            <BuilderCodeView
              files={data.files}
              entryFile={data.entry_file}
              addedPaths={addedPaths}
              changedPaths={changedPaths}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <BuilderCodeView
            files={data.files}
            entryFile={data.entry_file}
            addedPaths={addedPaths}
            changedPaths={changedPaths}
          />
        </div>
      )}

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
