import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import {
  desktopPolvoCode,
  type PolvoCodeDirEntry,
} from "@/lib/desktopApi";
import { cn } from "@/lib/utils";

type Props = {
  workspacePath: string;
  /** Pastas expandidas (relPath da pasta). */
  expanded: Set<string>;
  onExpandedChange: (next: Set<string>) => void;
  onOpenFile: (relPath: string) => void;
};

function DirRow({
  workspacePath,
  entry,
  depth,
  expanded,
  onExpandedChange,
  onOpenFile,
}: {
  workspacePath: string;
  entry: PolvoCodeDirEntry;
  depth: number;
  expanded: Set<string>;
  onExpandedChange: (next: Set<string>) => void;
  onOpenFile: (relPath: string) => void;
}) {
  const [children, setChildren] = useState<PolvoCodeDirEntry[] | null>(null);
  const isOpen = expanded.has(entry.relPath);

  useEffect(() => {
    if (!entry.isDirectory || !isOpen) return;
    let cancelled = false;
    void desktopPolvoCode.listDir({
      workspacePath,
      relPath: entry.relPath,
    }).then((r) => {
      if (cancelled || !r.ok) return;
      setChildren(r.entries);
    });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, entry.relPath, entry.isDirectory, isOpen]);

  const toggle = () => {
    const next = new Set(expanded);
    if (next.has(entry.relPath)) next.delete(entry.relPath);
    else next.add(entry.relPath);
    onExpandedChange(next);
  };

  const pad = 8 + depth * 14;

  if (!entry.isDirectory) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center gap-1 rounded-sm py-0.5 text-left text-[12px]",
          "text-muted-foreground hover:bg-accent/80 hover:text-foreground",
        )}
        style={{ paddingLeft: pad }}
        onClick={() => onOpenFile(entry.relPath)}
      >
        <File className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center gap-0.5 rounded-sm py-0.5 text-left text-[12px]",
          "text-muted-foreground hover:bg-accent/80 hover:text-foreground",
        )}
        style={{ paddingLeft: pad }}
        onClick={toggle}
      >
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-70" />
        )}
        <Folder className="size-3.5 shrink-0 text-sky-500/90" />
        <span className="truncate font-medium">{entry.name}</span>
      </button>
      {isOpen && children?.length ? (
        <div>
          {children.map((ch) => (
            <DirRow
              key={ch.relPath}
              workspacePath={workspacePath}
              entry={ch}
              depth={depth + 1}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PolvoCodeExplorer({
  workspacePath,
  expanded,
  onExpandedChange,
  onOpenFile,
}: Props) {
  const [rootEntries, setRootEntries] = useState<PolvoCodeDirEntry[]>([]);

  const loadRoot = useCallback(() => {
    void desktopPolvoCode
      .listDir({ workspacePath, relPath: "" })
      .then((r) => {
        if (r.ok) setRootEntries(r.entries);
      });
  }, [workspacePath]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Explorador
      </p>
      {rootEntries.map((e) => (
        <DirRow
          key={e.relPath}
          workspacePath={workspacePath}
          entry={e}
          depth={0}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          onOpenFile={onOpenFile}
        />
      ))}
      {rootEntries.length === 0 ? (
        <p className="px-2 text-[11px] text-muted-foreground">A carregar…</p>
      ) : null}
    </div>
  );
}
