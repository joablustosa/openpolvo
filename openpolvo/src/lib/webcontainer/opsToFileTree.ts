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

function findGeneratedPages(files: VirtualProjectFiles): string[] {
  const pages = Object.keys(files)
    .filter((k) => k.startsWith("src/pages/") && /\.(tsx|jsx)$/.test(k))
    .sort((a, b) => {
      const score = (p: string) => {
        for (let i = 0; i < ENTRY_PAGE_CANDIDATES.length; i++) {
          if (p === ENTRY_PAGE_CANDIDATES[i]) return i;
        }
        return 100;
      };
      return score(a) - score(b);
    });
  return pages;
}

/** Procura a primeira página candidata gerada pela IA (ou null). */
function findGeneratedEntry(files: VirtualProjectFiles): string | null {
  for (const c of ENTRY_PAGE_CANDIDATES) {
    if (typeof files[c] === "string") return c;
  }
  const pages = findGeneratedPages(files);
  return pages[0] ?? null;
}

/** Converte caminho de ficheiro em import relativo a `src/`. */
function toRelativeImport(path: string): string {
  const rel = path.replace(/^src\//, "./").replace(/\.tsx?$/, "");
  return rel;
}

function pageNameFromPath(path: string): string {
  return path.split("/").pop()!.replace(/\.(tsx|jsx)$/i, "");
}

function routePathFromPageName(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower === "index" ||
    lower === "home" ||
    lower === "homepage" ||
    lower === "landingpage" ||
    lower === "landing"
  ) {
    return "/";
  }
  const stripped = name.replace(/Page$/i, "");
  return `/${stripped.charAt(0).toLowerCase()}${stripped.slice(1)}`;
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

function userProvidedValidApp(files: VirtualProjectFiles): boolean {
  const app = files["src/App.tsx"];
  if (typeof app !== "string" || !app.trim()) return false;
  if (app.includes("Open Polvo Preview")) return false;
  if (app.includes("<Routes") || app.includes("<Route")) return true;
  if (app.includes("from \"react-router-dom\"") || app.includes("from 'react-router-dom'"))
    return true;
  const entry = findGeneratedEntry(files);
  if (!entry) return true;
  const comp = pageNameFromPath(entry);
  return app.includes(`<${comp}`) || app.includes(`<${comp} `);
}

function generateRouterAppTsx(
  pages: string[],
  merged: VirtualProjectFiles,
): string {
  const sidebarProp = useSidebarInApp(merged) ? " showSidebar" : "";
  const imports = pages
    .map((p) => {
      const name = pageNameFromPath(p);
      return `import ${name} from "${toRelativeImport(p)}";`;
    })
    .join("\n");

  const routeLines = pages.map((p) => {
    const name = pageNameFromPath(p);
    const routePath = routePathFromPageName(name);
    return `        <Route path="${routePath}" element={<${name} />} />`;
  });

  const shellOpen = hasLayoutShell(merged)
    ? `    <AppShell${sidebarProp}>`
    : `    <div className="min-h-screen w-full min-w-0 bg-background text-foreground">`;
  const shellClose = hasLayoutShell(merged) ? "    </AppShell>" : "    </div>";
  const shellImport = hasLayoutShell(merged)
    ? 'import AppShell from "@/components/layout/AppShell";\n'
    : "";

  return `import { Navigate, Route, Routes } from "react-router-dom";
${shellImport}${imports}

export default function App() {
  return (
${shellOpen}
      <Routes>
${routeLines.join("\n")}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
${shellClose}
  );
}
`;
}

function generateSinglePageAppTsx(entry: string, merged: VirtualProjectFiles): string {
  const importName = pageNameFromPath(entry);
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
    return `import AppShell from "@/components/layout/AppShell";
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
  }

  return `import ${importName} from "${importPath}";
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

function applyLayoutFallbacks(
  merged: VirtualProjectFiles,
  baseScaffold: VirtualProjectFiles,
): VirtualProjectFiles {
  const out = { ...merged };
  for (const layoutPath of LAYOUT_SCAFFOLD_PATHS) {
    const aiLayout = out[layoutPath];
    const scaffoldLayout = baseScaffold[layoutPath];
    if (!scaffoldLayout) continue;
    if (typeof aiLayout !== "string" || !aiLayout.trim()) {
      out[layoutPath] = scaffoldLayout;
      continue;
    }
    if (previewSourceHasForbiddenImports(aiLayout)) {
      out[layoutPath] = scaffoldLayout;
    }
  }
  return out;
}

/**
 * Garante package.json + stack shadcn se a IA enviar projecto incompleto.
 * - Junta scaffold Vite/React/TS/Tailwind v4/shadcn quando não há `package.json`.
 * - Monta rotas a partir de `src/pages/*` quando App.tsx não foi fornecido ou é placeholder.
 */
export function ensureRunnableViteProject(
  files: VirtualProjectFiles,
  designTokens?: Partial<DesignTokens>,
): VirtualProjectFiles {
  const baseScaffold = getShadcnViteScaffold(designTokens);
  const safeAi = sanitizeAiFiles(files, baseScaffold);
  let merged: VirtualProjectFiles = { ...baseScaffold, ...safeAi };
  merged = applyLayoutFallbacks(merged, baseScaffold);

  const pages = findGeneratedPages(merged);
  const userApp = userProvidedValidApp(safeAi);

  if (pages.length >= 2 && !userApp) {
    merged["src/App.tsx"] = generateRouterAppTsx(pages, merged);
  } else {
    const entry = findGeneratedEntry(merged);
    if (entry && !userApp) {
      merged["src/App.tsx"] = generateSinglePageAppTsx(entry, merged);
    }
  }

  return merged;
}

/** Funde snapshot existente + ops do turno e prepara projecto completo. */
export function mergeProjectWithOps(
  baseFiles: VirtualProjectFiles,
  ops: DevStudioOp[],
  designTokens?: Partial<DesignTokens>,
): VirtualProjectFiles {
  const withOps = applyOpsToVirtualFiles(baseFiles, ops);
  return ensureRunnableViteProject(withOps, designTokens);
}

/** Converte diferença entre dois mapas em ops write (para apply incremental no Electron). */
export function mergedFilesToWriteOps(
  before: VirtualProjectFiles,
  after: VirtualProjectFiles,
): DevStudioOp[] {
  const ops: DevStudioOp[] = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of allPaths) {
    const next = after[path];
    if (next === undefined) continue;
    if (before[path] !== next) {
      ops.push({ op: "write", path, content: next });
    }
  }
  return ops;
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
