import type { DirectoryNode, FileSystemTree } from "@webcontainer/api";
import type { BuilderFile } from "@/lib/builderMetadata";

/** Normaliza caminhos vindos do builder (Windows / barras iniciais). */
export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function fileBasename(path: string): string {
  const p = normalizeFsPath(path);
  const parts = p.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Converte a lista plana `files` do Builder numa {@link FileSystemTree} para `webcontainer.mount`.
 */
export function builderFilesToFileSystemTree(files: BuilderFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const f of files) {
    const p = normalizeFsPath(f.path);
    if (!p) continue;
    const parts = p.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        cursor[name] = { file: { contents: f.content } };
      } else {
        const existing = cursor[name];
        if (!existing || !("directory" in existing)) {
          cursor[name] = { directory: {} };
        }
        cursor = (cursor[name] as DirectoryNode).directory;
      }
    }
  }
  return root;
}

export function hasPackageJson(files: BuilderFile[]): boolean {
  return files.some((f) => fileBasename(f.path) === "package.json");
}

/**
 * Modo inicial do painel: com `package.json` (incl. injectado por
 * `prepareBuilderFilesForWebContainer`) usa-se WebContainer; caso contrário, tabs HTML/código.
 */
export function defaultBuilderVisualMode(
  files: BuilderFile[],
): "standard" | "webcontainer" {
  if (hasPackageJson(files)) return "webcontainer";
  return "standard";
}

export type WebContainerCommands =
  | {
      ok: true;
      installCommand: string;
      installArgs: string[];
      startCommand: string;
      startArgs: string[];
      /** Variáveis extra para o processo dev (ex. CRA com HOST). */
      startEnv?: Record<string, string | number | boolean>;
    }
  | { ok: false; reason: string };

/** Lê a secção `scripts` do package.json (se existir e for JSON válido). */
export function readPackageScripts(files: BuilderFile[]): Record<string, string> {
  const pkg = files.find((f) => fileBasename(f.path) === "package.json");
  if (!pkg) return {};
  try {
    const j = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
    return j.scripts ?? {};
  } catch {
    return {};
  }
}

function hasViteConfigFile(files: BuilderFile[]): boolean {
  return files.some((f) => /vite\.config\.(ts|mts|js|mjs|cjs)$/i.test(normalizeFsPath(f.path)));
}

/**
 * `npm install` + arranque do dev server com **host exposto** (StackBlitz / WebContainers).
 * Vite: `npm run dev -- --host 0.0.0.0`; Next: `--hostname 0.0.0.0`; CRA: env HOST.
 */
export function inferWebContainerSpawnCommands(files: BuilderFile[]): WebContainerCommands {
  if (!hasPackageJson(files)) {
    return {
      ok: false,
      reason:
        "Não foi encontrado package.json. O preview WebContainer requer um projecto Node (ex. React + Vite). Use o preview HTML nas tabs.",
    };
  }

  const scripts = readPackageScripts(files);
  const devRaw = (scripts.dev ?? "").trim();
  const dev = devRaw.toLowerCase();

  let startCommand = "npm";
  let startArgs: string[] = ["run", "dev", "--", "--host", "0.0.0.0"];
  let startEnv: Record<string, string | number | boolean> | undefined;

  if (dev.includes("next")) {
    startArgs = ["run", "dev", "--", "--hostname", "0.0.0.0"];
  } else if (dev.includes("vite") || hasViteConfigFile(files)) {
    // Sem `--strictPort`: no WebContainer uma porta ocupada faria o Vite sair sem URL de preview;
    // sem isso o Vite escolhe a seguinte porta livre e continuamos a receber `server-ready` / `port`.
    startArgs = ["run", "dev", "--", "--host", "0.0.0.0"];
  } else if (dev.includes("react-scripts")) {
    startArgs = ["run", "start"];
    startEnv = { HOST: "0.0.0.0", BROWSER: "none" };
  } else if (devRaw) {
    startArgs = ["run", "dev", "--", "--host", "0.0.0.0"];
  } else if (hasViteConfigFile(files)) {
    startCommand = "npx";
    startArgs = ["vite", "--host", "0.0.0.0"];
  } else {
    startArgs = ["run", "dev"];
  }

  return {
    ok: true,
    installCommand: "npm",
    installArgs: ["install"],
    startCommand,
    startArgs,
    ...(startEnv ? { startEnv } : {}),
  };
}

/** Assinatura estável para re-boot quando o projecto mudar. */
export function builderFilesSignature(files: BuilderFile[]): string {
  let n = 0;
  const paths = files.map((f) => {
    n += f.content.length;
    return normalizeFsPath(f.path);
  });
  paths.sort();
  return `${paths.join("\0")}\0${n}`;
}
