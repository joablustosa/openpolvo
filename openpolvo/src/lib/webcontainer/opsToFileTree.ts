import type { FileSystemTree } from "@webcontainer/api";

import type { DevStudioOp } from "@/lib/devStudioMetadata";
import {
  previewSourceHasForbiddenImports,
  sanitizePreviewTsx,
} from "@/lib/devStudio/sanitizePreviewSource";
import {
  getShadcnViteScaffold,
  type DesignTokens,
} from "./shadcnScaffold";
import { LAYOUT_SCAFFOLD_PATHS } from "@/lib/devStudio/layoutScaffoldHeal";
import type { VirtualProjectFiles } from "./types";

function normPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function sanitizeAiFiles(
  ai: VirtualProjectFiles,
  scaffold: VirtualProjectFiles,
): VirtualProjectFiles {
  const out: VirtualProjectFiles = { ...ai };
  for (const [path, content] of Object.entries(ai)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue;
    let next = sanitizePreviewTsx(content, path);
    if (
      (LAYOUT_SCAFFOLD_PATHS as readonly string[]).includes(path) &&
      previewSourceHasForbiddenImports(next) &&
      scaffold[path]
    ) {
      next = scaffold[path];
    }
    out[path] = next;
  }
  return out;
}

/** Converte mapa plano em FileSystemTree aninhado para WebContainer.mount(). */
export function flatFilesToFileSystemTree(files: VirtualProjectFiles): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [rawPath, content] of Object.entries(files)) {
    const path = normPath(rawPath);
    if (!path || path.includes("..")) continue;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) continue;

    let cursor = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      const existing = cursor[dir];
      if (!existing || !("directory" in existing)) {
        cursor[dir] = { directory: {} };
      }
      cursor = (cursor[dir] as { directory: FileSystemTree }).directory;
    }

    const fileName = parts[parts.length - 1];
    cursor[fileName] = {
      file: { contents: content ?? "" },
    };
  }

  return tree;
}

/** Aplica operações write/mkdir sobre o mapa plano em memória. */
export function applyOpsToVirtualFiles(
  base: VirtualProjectFiles,
  ops: DevStudioOp[],
): VirtualProjectFiles {
  const next: VirtualProjectFiles = { ...base };

  for (const op of ops) {
    const path = normPath(op.path);
    if (!path || path.includes("..")) continue;
    if (op.op === "write") {
      const raw = op.content ?? "";
      next[path] = /\.(tsx|jsx)$/.test(path)
        ? sanitizePreviewTsx(raw, path)
        : raw;
    }
  }

  return next;
}

export function virtualFilesFromOps(ops: DevStudioOp[]): VirtualProjectFiles {
  return applyOpsToVirtualFiles({}, ops);
}

/** Caminhos de páginas que a IA pode gerar, em ordem de preferência. */
const ENTRY_PAGE_CANDIDATES = [
  "src/pages/LandingPage.tsx",
  "src/pages/Home.tsx",
  "src/pages/HomePage.tsx",
  "src/pages/Index.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/App.tsx",
  "src/Landing.tsx",
  "src/components/Landing.tsx",
];

/** Procura a primeira página candidata gerada pela IA (ou null). */
function findGeneratedEntry(files: VirtualProjectFiles): string | null {
  for (const c of ENTRY_PAGE_CANDIDATES) {
    if (typeof files[c] === "string") return c;
  }
  const page = Object.keys(files).find(
    (k) => k.startsWith("src/pages/") && k.endsWith(".tsx"),
  );
  return page ?? null;
}

/** Converte caminho de ficheiro em import relativo a `src/`. */
function toRelativeImport(path: string): string {
  const rel = path.replace(/^src\//, "./").replace(/\.tsx?$/, "");
  return rel;
}

function hasLayoutShell(files: VirtualProjectFiles): boolean {
  return typeof files["src/components/layout/AppShell.tsx"] === "string";
}

function useSidebarInApp(files: VirtualProjectFiles): boolean {
  return (
    typeof files["src/components/layout/Sidebar.tsx"] === "string" ||
    files["src/components/layout/AppShell.tsx"]?.includes("showSidebar") === true
  );
}

/**
 * Garante package.json + stack shadcn se a IA enviar projecto incompleto.
 * - Junta scaffold Vite/React/TS/Tailwind v4/shadcn quando não há `package.json`.
 * - Monta página gerada dentro de `AppShell` quando layout existe.
 */
export function ensureRunnableViteProject(
  files: VirtualProjectFiles,
  designTokens?: Partial<DesignTokens>,
): VirtualProjectFiles {
  const baseScaffold = getShadcnViteScaffold(designTokens);
  const safeAi = sanitizeAiFiles(files, baseScaffold);
  let merged: VirtualProjectFiles = { ...baseScaffold, ...safeAi };
  for (const layoutPath of LAYOUT_SCAFFOLD_PATHS) {
    if (baseScaffold[layoutPath]) {
      merged[layoutPath] = baseScaffold[layoutPath];
    }
  }

  const entry = findGeneratedEntry(merged);
  const userProvidedApp = typeof files["src/App.tsx"] === "string";

  if (entry && !userProvidedApp) {
    const importName = entry
      .split("/")
      .pop()!
      .replace(/\.tsx?$/, "");
    const importPath = toRelativeImport(entry);

    const cssCandidates = [
      entry.replace(/\.tsx?$/, ".css"),
      `src/styles/${importName}.css`,
      `src/styles/${importName.toLowerCase()}.css`,
    ];
    const cssMatch = cssCandidates.find((p) => typeof merged[p] === "string");
    const cssImport = cssMatch ? `import "${toRelativeImport(cssMatch)}";\n` : "";

    if (hasLayoutShell(merged)) {
      const sidebarProp = useSidebarInApp(merged) ? " showSidebar" : "";
      merged["src/App.tsx"] = `import AppShell from "@/components/layout/AppShell";
import ${importName} from "${importPath}";
${cssImport}
export default function App() {
  return (
    <AppShell${sidebarProp}>
      <${importName} />
    </AppShell>
  );
}
`;
    } else {
      merged["src/App.tsx"] = `import ${importName} from "${importPath}";
${cssImport}
export default function App() {
  return (
    <div className="min-h-screen w-full min-w-0 bg-background text-foreground">
      <${importName} />
    </div>
  );
}
`;
    }
  }

  return merged;
}

/** Ficheiros prontos para gravar no disco (Electron) a partir das ops da IA. */
export function devStudioWriteFilesFromOps(
  ops: DevStudioOp[],
  designTokens?: Partial<DesignTokens>,
): { path: string; content: string }[] {
  const prepared = ensureRunnableViteProject(
    virtualFilesFromOps(ops),
    designTokens,
  );
  return Object.entries(prepared).map(([path, content]) => ({ path, content }));
}
