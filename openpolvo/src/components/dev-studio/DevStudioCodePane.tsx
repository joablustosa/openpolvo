import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { collectElectronProjectFiles } from "@/lib/devStudio/collectElectronProjectFiles";
import { isWebContainerWorkspace } from "@/lib/webcontainer/types";
import { cn } from "@/lib/utils";

type Props = {
  workspacePath: string;
  reloadKey: number;
  className?: string;
};

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    default:
      return "plaintext";
  }
}

export function DevStudioCodePane({ workspacePath, reloadKey, className }: Props) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let next: Record<string, string> = {};
        if (isWebContainerWorkspace(workspacePath)) {
          const { getWebContainerPreviewService } = await import("@/lib/webcontainer");
          next = getWebContainerPreviewService().getVirtualFiles();
        } else if (workspacePath.trim()) {
          next = await collectElectronProjectFiles(workspacePath);
        }
        if (cancelled) return;
        setFiles(next);
        const paths = Object.keys(next).sort((a, b) => a.localeCompare(b));
        setSelectedPath((prev) => (prev && next[prev] != null ? prev : paths[0] ?? null));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha ao carregar ficheiros");
          setFiles({});
          setSelectedPath(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, reloadKey]);

  const paths = useMemo(() => Object.keys(files).sort((a, b) => a.localeCompare(b)), [files]);
  const content = selectedPath ? (files[selectedPath] ?? "") : "";

  if (loading && paths.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="size-4 animate-spin" />
        A carregar código…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-center text-sm text-destructive", className)}>
        {error}
      </div>
    );
  }

  if (paths.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground", className)}>
        Ainda não há ficheiros no projecto.
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 overflow-hidden", className)}>
      <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-muted/20">
        <p className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Ficheiros
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {paths.map((path) => (
            <button
              key={path}
              type="button"
              title={path}
              onClick={() => setSelectedPath(path)}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left text-xs transition-colors",
                selectedPath === path
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {path}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        <Editor
          key={selectedPath ?? "empty"}
          height="100%"
          language={selectedPath ? languageFromPath(selectedPath) : "plaintext"}
          value={content}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
