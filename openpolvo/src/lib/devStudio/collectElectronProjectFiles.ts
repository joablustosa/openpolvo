import { desktopPolvoCode } from "@/lib/desktopApi";

const MAX_FILES = 80;
const MAX_BYTES_PER_FILE = 48_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
]);
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".lock",
]);
const PRIORITY_SUBSTRINGS = [
  "package.json",
  "middleware",
  "next.config",
  "vite.config",
  "tsconfig",
  "go.mod",
  "src/",
  "app/",
  "internal/",
  "routes",
  "auth",
  "supabase",
];

function shouldIndexFile(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  const dot = p.lastIndexOf(".");
  const ext = dot >= 0 ? p.slice(dot).toLowerCase() : "";
  if (SKIP_EXT.has(ext)) return false;
  if (!ext && !PRIORITY_SUBSTRINGS.some((s) => p.includes(s))) return false;
  return true;
}

function scorePath(path: string): number {
  const p = path.toLowerCase();
  let s = 0;
  for (let i = 0; i < PRIORITY_SUBSTRINGS.length; i++) {
    if (p.includes(PRIORITY_SUBSTRINGS[i])) s += 100 - i;
  }
  return s;
}

function trimFileContent(content: string): string {
  const enc = new TextEncoder().encode(content);
  if (enc.length <= MAX_BYTES_PER_FILE) return content;
  return new TextDecoder().decode(enc.slice(0, MAX_BYTES_PER_FILE));
}

/** Lê ficheiros indexáveis do projecto no disco (Electron). */
export async function collectElectronProjectFiles(
  workspacePath: string,
): Promise<Record<string, string>> {
  const tree: string[] = [];
  const files: Record<string, string> = {};

  async function walk(relPath: string) {
    if (tree.length >= MAX_FILES) return;
    const lr = await desktopPolvoCode.listDir({ workspacePath, relPath });
    if (!lr.ok || !("entries" in lr)) return;
    for (const ent of lr.entries) {
      if (tree.length >= MAX_FILES) break;
      const rp = ent.relPath.replace(/\\/g, "/");
      if (ent.isDirectory) {
        if (!SKIP_DIRS.has(ent.name)) await walk(rp);
      } else if (shouldIndexFile(rp)) {
        tree.push(rp);
      }
    }
  }

  await walk("");
  tree.sort((a, b) => scorePath(b) - scorePath(a));
  const selected = tree.slice(0, MAX_FILES);
  for (const path of selected) {
    const rf = await desktopPolvoCode.readFile({ workspacePath, relPath: path });
    if (rf.ok && "content" in rf) {
      files[path] = trimFileContent(rf.content);
    }
  }
  return files;
}
