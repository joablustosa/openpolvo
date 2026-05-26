import { desktopPolvoCode } from "@/lib/desktopApi";

const MAX_HEAL_FILES = 8;

/** Extrai paths `src/...` referidos no log Vite/tsc. */
export function pathsFromCompileLog(compileLog: string): string[] {
  const found = new Set<string>();

  for (const m of compileLog.matchAll(/(src\/[\w./-]+\.tsx?):\d+/g)) {
    found.add(m[1]);
  }
  for (const m of compileLog.matchAll(
    /from\s+["'](@\/[^"']+|src\/[^"']+)["']/g,
  )) {
    const p = m[1].replace(/^@\//, "src/").replace(/\\/g, "/");
    if (p.startsWith("src/")) found.add(p);
  }

  return [...found].slice(0, MAX_HEAL_FILES);
}

/**
 * Lê só ficheiros relevantes para self-heal (muito mais rápido que 80 ficheiros).
 */
export async function collectProjectFilesForHeal(
  workspacePath: string,
  compileLog: string,
): Promise<Record<string, string>> {
  const paths = new Set<string>(["package.json", "src/App.tsx"]);
  for (const p of pathsFromCompileLog(compileLog)) {
    paths.add(p);
  }

  const files: Record<string, string> = {};
  for (const relPath of paths) {
    const rf = await desktopPolvoCode.readFile({ workspacePath, relPath });
    if (rf.ok && "content" in rf) {
      files[relPath.replace(/\\/g, "/")] = rf.content;
    }
  }
  return files;
}

/** Subconjunto do mapa virtual (WebContainer) para self-heal — sem I/O disco. */
export function pickVirtualFilesForHeal(
  allFiles: Record<string, string>,
  compileLog: string,
): Record<string, string> {
  const paths = new Set<string>(["package.json", "src/App.tsx"]);
  for (const p of pathsFromCompileLog(compileLog)) {
    paths.add(p);
  }
  const out: Record<string, string> = {};
  for (const p of paths) {
    if (typeof allFiles[p] === "string") {
      out[p] = allFiles[p];
    }
  }
  if (Object.keys(out).length < 2) {
    return allFiles;
  }
  return out;
}
