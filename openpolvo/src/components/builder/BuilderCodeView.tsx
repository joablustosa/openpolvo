import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react";
import type { BuilderFile } from "@/lib/builderMetadata";
import { CodeBlock } from "./CodeBlock";
import { cn } from "@/lib/utils";

type Props = {
  files: BuilderFile[];
  entryFile?: string;
  /** Caminhos de ficheiros adicionados neste turno (destaque verde). */
  addedPaths?: ReadonlySet<string>;
  /** Caminhos de ficheiros modificados neste turno (destaque âmbar). */
  changedPaths?: ReadonlySet<string>;
};

// ─── Árvore de ficheiros ─────────────────────────────────────────────────────

type DirNode = {
  type: "dir";
  name: string;
  path: string;
  children: Map<string, TreeNode>;
};

type FileNode = {
  type: "file";
  name: string;
  path: string;
  file: BuilderFile;
};

type TreeNode = DirNode | FileNode;

function buildTree(files: BuilderFile[]): DirNode {
  const root: DirNode = { type: "dir", name: "", path: "", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur: DirNode = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cur.children.set(name, { type: "file", name, path: f.path, file: f });
      } else {
        const existing = cur.children.get(name);
        if (existing && existing.type === "dir") {
          cur = existing;
        } else {
          const next: DirNode = {
            type: "dir",
            name,
            path: parts.slice(0, i + 1).join("/"),
            children: new Map(),
          };
          cur.children.set(name, next);
          cur = next;
        }
      }
    }
  }
  return root;
}

function sortedChildren(dir: DirNode): TreeNode[] {
  const entries = Array.from(dir.children.values());
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

type TreeItemProps = {
  node: TreeNode;
  depth: number;
  activePath: string;
  onSelect: (path: string) => void;
  expanded: Set<string>;
  toggleDir: (path: string) => void;
  addedPaths?: ReadonlySet<string>;
  changedPaths?: ReadonlySet<string>;
};

function TreeItem({ node, depth, activePath, onSelect, expanded, toggleDir, addedPaths, changedPaths }: TreeItemProps) {
  const pad = { paddingLeft: 8 + depth * 12 };
  if (node.type === "dir") {
    const isOpen = expanded.has(node.path);
    return (
      <>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          className="flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          style={pad}
        >
          {isOpen ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen
          ? sortedChildren(node).map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onSelect={onSelect}
                expanded={expanded}
                toggleDir={toggleDir}
                addedPaths={addedPaths}
                changedPaths={changedPaths}
              />
            ))
          : null}
      </>
    );
  }
  const active = activePath === node.path;
  const isAdded = addedPaths?.has(node.path);
  const isChanged = !isAdded && changedPaths?.has(node.path);
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs hover:bg-muted/50",
        active
          ? "bg-accent/60 font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      style={pad}
    >
      <span className="size-3.5 shrink-0" />
      <FileCode2 className={cn("size-3.5 shrink-0", isAdded ? "text-emerald-500" : isChanged ? "text-amber-500" : "")} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {isAdded ? (
        <span className="ml-auto shrink-0 size-1.5 rounded-full bg-emerald-500" title="Adicionado" />
      ) : isChanged ? (
        <span className="ml-auto shrink-0 size-1.5 rounded-full bg-amber-500" title="Modificado" />
      ) : null}
    </button>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function BuilderCodeView({ files, entryFile, addedPaths, changedPaths }: Props) {
  const root = useMemo(() => buildTree(files), [files]);
  const initialActive = useMemo(() => {
    if (!files.length) return "";
    if (entryFile && files.some((f) => f.path === entryFile)) return entryFile;
    // Prioriza um App.tsx / index.ts se existir.
    const priority = files.find((f) =>
      /(^|\/)(App\.tsx|main\.tsx|index\.ts|index\.tsx|main\.go)$/.test(f.path),
    );
    return (priority ?? files[0]).path;
  }, [files, entryFile]);

  const [activePath, setActivePath] = useState<string>(initialActive);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expande todos os directórios pai do ficheiro activo por defeito.
    const s = new Set<string>();
    if (initialActive) {
      const parts = initialActive.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        s.add(parts.slice(0, i).join("/"));
      }
    }
    // Expande directórios de topo.
    for (const top of root.children.values()) {
      if (top.type === "dir") s.add(top.path);
    }
    return s;
  });

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const active = files.find((f) => f.path === activePath) ?? files[0];

  if (!files.length) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Sem ficheiros gerados.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/10 py-2">
        {sortedChildren(root).map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={0}
            activePath={activePath}
            onSelect={setActivePath}
            expanded={expanded}
            toggleDir={toggleDir}
            addedPaths={addedPaths}
            changedPaths={changedPaths}
          />
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <CodeBlock
            code={active.content}
            language={active.language}
            filename={active.path}
          />
        ) : null}
      </div>
    </div>
  );
}
