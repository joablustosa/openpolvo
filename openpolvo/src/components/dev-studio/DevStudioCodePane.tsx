import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectElectronProjectFiles } from "@/lib/devStudio/collectElectronProjectFiles";
import { desktopPolvoCode } from "@/lib/desktopApi";
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
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const selectedContent = selectedPath ? (files[selectedPath] ?? "") : "";
  const isDirty = Boolean(selectedPath) && draft !== selectedContent;

  const expandParentsForPath = useCallback((path: string) => {
    const parts = path.split("/");
    if (parts.length <= 1) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < parts.length - 1; i++) {
        next.add(parts.slice(0, i + 1).join("/"));
      }
      return next;
    });
  }, []);

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
        setDraft((prev) => {
          const pick = paths[0] ?? null;
          if (!pick) return "";
          return next[pick] ?? prev;
        });
        setExpandedFolders(new Set(paths.flatMap((p) => {
          const parts = p.split("/");
          const all: string[] = [];
          for (let i = 0; i < parts.length - 1; i++) all.push(parts.slice(0, i + 1).join("/"));
          return all;
        })));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha ao carregar ficheiros");
          setFiles({});
          setSelectedPath(null);
          setDraft("");
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

  useEffect(() => {
    if (!selectedPath) {
      setDraft("");
      return;
    }
    setDraft(files[selectedPath] ?? "");
    expandParentsForPath(selectedPath);
  }, [selectedPath, files, expandParentsForPath]);

  type TreeNode = { name: string; path: string; isDir: boolean; children: Map<string, TreeNode> };
  const treeRoots = useMemo(() => {
    const roots = new Map<string, TreeNode>();
    const ensureNode = (map: Map<string, TreeNode>, name: string, path: string, isDir: boolean) => {
      const found = map.get(name);
      if (found) return found;
      const node: TreeNode = { name, path, isDir, children: new Map() };
      map.set(name, node);
      return node;
    };
    for (const full of paths) {
      const parts = full.split("/");
      let cur = roots;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        acc = acc ? `${acc}/${part}` : part;
        const isDir = i < parts.length - 1;
        const node = ensureNode(cur, part, acc, isDir);
        cur = node.children;
      }
    }
    return roots;
  }, [paths]);

  type TreeRow = { key: string; depth: number; isDir: boolean; path: string; label: string };
  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const visit = (map: Map<string, TreeNode>, depth: number) => {
      const nodes = [...map.values()].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) {
        out.push({ key: n.path, depth, isDir: n.isDir, path: n.path, label: n.name });
        if (n.isDir && expandedFolders.has(n.path)) {
          visit(n.children, depth + 1);
        }
      }
    };
    visit(treeRoots, 0);
    return out;
  }, [treeRoots, expandedFolders]);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  const reloadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      let next: Record<string, string> = {};
      if (isWebContainerWorkspace(workspacePath)) {
        const { getWebContainerPreviewService } = await import("@/lib/webcontainer");
        next = getWebContainerPreviewService().getVirtualFiles();
      } else if (workspacePath.trim()) {
        next = await collectElectronProjectFiles(workspacePath);
      }
      setFiles(next);
      if (selectedPath && next[selectedPath] != null) {
        setDraft(next[selectedPath] ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao recarregar ficheiros");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, selectedPath]);

  const saveFile = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      if (isWebContainerWorkspace(workspacePath)) {
        const { getWebContainerPreviewService } = await import("@/lib/webcontainer");
        const svc = getWebContainerPreviewService();
        const runNpmInstall = !svc.hasInstalledOnce();
        await svc.runProject({
          ops: [{ op: "write", path: selectedPath, content: draft }],
          npmInstall: runNpmInstall,
        });
        const refreshed = svc.getVirtualFiles();
        setFiles(refreshed);
        setDraft(refreshed[selectedPath] ?? draft);
      } else {
        const wr = await desktopPolvoCode.writeFile({
          workspacePath,
          relPath: selectedPath,
          content: draft,
          createDirs: true,
        });
        if (!wr.ok) {
          throw new Error(wr.error || "Falha ao guardar ficheiro");
        }
        setFiles((prev) => ({ ...prev, [selectedPath]: draft }));
      }
      setInfo("Ficheiro guardado com sucesso.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao guardar ficheiro");
    } finally {
      setSaving(false);
    }
  }, [selectedPath, draft, workspacePath]);

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
      <aside className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-muted/20">
        <p className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Explorer
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              title={row.path}
              onClick={() => {
                if (row.isDir) {
                  toggleFolder(row.path);
                } else {
                  setSelectedPath(row.path);
                }
              }}
              className={cn(
                "flex w-full items-center gap-1.5 truncate px-2 py-1.5 text-left text-xs transition-colors",
                !row.isDir && selectedPath === row.path
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              style={{ paddingLeft: `${8 + row.depth * 14}px` }}
            >
              {row.isDir ? (
                <>
                  {expandedFolders.has(row.path) ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                  <Folder className="size-3.5 shrink-0" />
                  <span className="truncate">{row.label}</span>
                </>
              ) : (
                <>
                  <FileCode2 className="size-3.5 shrink-0" />
                  <span className="truncate">{row.label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {selectedPath ?? "Sem ficheiro seleccionado"}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Recarregar ficheiros"
            disabled={loading || saving}
            onClick={() => void reloadFiles()}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={!selectedPath || !isDirty || saving}
            onClick={() => void saveFile()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar
          </Button>
        </div>
        {error ? (
          <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-xs text-destructive">{error}</div>
        ) : null}
        {!error && info ? (
          <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-xs text-emerald-600">{info}</div>
        ) : null}
        <Editor
          key={selectedPath ?? "empty"}
          height="100%"
          language={selectedPath ? languageFromPath(selectedPath) : "plaintext"}
          value={draft}
          theme="vs-dark"
          onChange={(v) => setDraft(v ?? "")}
          options={{
            readOnly: !selectedPath || saving,
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
