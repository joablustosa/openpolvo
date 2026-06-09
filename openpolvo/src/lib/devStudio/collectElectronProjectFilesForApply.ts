import { desktopPolvoCode } from "@/lib/desktopApi";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".data",
]);
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".lock",
]);

function shouldIncludeForApply(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  const dot = p.lastIndexOf(".");
  const ext = dot >= 0 ? p.slice(dot).toLowerCase() : "";
  if (SKIP_EXT.has(ext)) return false;
  if (
    p === "package.json" ||
    p.startsWith("src/") ||
    p.startsWith("server/") ||
    p.endsWith(".config.ts") ||
    p.endsWith(".config.js") ||
    p === "index.html" ||
    p.startsWith("tsconfig")
  ) {
    return true;
  }
  return false;
}

/** Lê todos os ficheiros relevantes do projecto para merge/apply (sem limite de chat). */
export async function collectElectronProjectFilesForApply(
  workspacePath: string,
): Promise<Record<string, string>> {
  const tree: string[] = [];
  const files: Record<string, string> = {};

  async function walk(relPath: string) {
    const lr = await desktopPolvoCode.listDir({ workspacePath, relPath });
    if (!lr.ok || !("entries" in lr)) return;
    for (const ent of lr.entries) {
      const rp = ent.relPath.replace(/\\/g, "/");
      if (ent.isDirectory) {
        if (!SKIP_DIRS.has(ent.name)) await walk(rp);
      } else if (shouldIncludeForApply(rp)) {
        tree.push(rp);
      }
    }
  }

  await walk("");
  for (const path of tree.sort()) {
    const rf = await desktopPolvoCode.readFile({ workspacePath, relPath: path });
    if (rf.ok && "content" in rf) {
      files[path] = rf.content;
    }
  }
  return files;
}
