/**
 * Patch incremental do WebContainer: só escreve ficheiros alterados via `wc.fs.writeFile`.
 * O Vite HMR detecta as alterações e actualiza o preview sem reiniciar o servidor.
 *
 * Baseado na abordagem do Bolt.new / Lovable: manter o container vivo e só actualizar
 * o que mudou, eliminando o `npm install` repetido (90-180s) em cada abertura do preview.
 */
import type { WebContainer } from "@webcontainer/api";
import type { BuilderFile } from "@/lib/builderMetadata";
import { normalizeFsPath } from "@/lib/builderToWebContainerFiles";

export type FileDiff = {
  toWrite: BuilderFile[];
  toDelete: string[];
  packageJsonChanged: boolean;
  hasChanges: boolean;
};

/** Calcula a diferença entre dois snapshots de ficheiros. */
export function diffBuilderFiles(prev: BuilderFile[], next: BuilderFile[]): FileDiff {
  const prevMap = new Map(prev.map((f) => [normalizeFsPath(f.path), f.content ?? ""]));
  const nextMap = new Map(next.map((f) => [normalizeFsPath(f.path), f.content ?? ""]));

  const toWrite: BuilderFile[] = [];
  const toDelete: string[] = [];
  let packageJsonChanged = false;

  for (const f of next) {
    const path = normalizeFsPath(f.path);
    if (prevMap.get(path) !== (f.content ?? "")) {
      toWrite.push(f);
      if (path === "package.json") packageJsonChanged = true;
    }
  }

  for (const [path] of prevMap) {
    if (!nextMap.has(path)) {
      toDelete.push(path);
      if (path === "package.json") packageJsonChanged = true;
    }
  }

  return {
    toWrite,
    toDelete,
    packageJsonChanged,
    hasChanges: toWrite.length > 0 || toDelete.length > 0,
  };
}

/**
 * Escreve só os ficheiros alterados no WebContainer.
 * Caminhos relativos ao `wc.workdir` (ex. `/project/src/App.tsx`).
 */
export async function patchWebContainerFiles(wc: WebContainer, diff: FileDiff): Promise<void> {
  const workdir = wc.workdir;

  for (const file of diff.toWrite) {
    const rel = normalizeFsPath(file.path);
    const fullPath = `${workdir}/${rel}`;
    const parts = rel.split("/").filter(Boolean);
    if (parts.length > 1) {
      const dir = `${workdir}/${parts.slice(0, -1).join("/")}`;
      try {
        await wc.fs.mkdir(dir, { recursive: true });
      } catch {
        // directório já existe
      }
    }
    await wc.fs.writeFile(fullPath, file.content ?? "");
  }

  for (const rel of diff.toDelete) {
    try {
      await wc.fs.rm(`${workdir}/${rel}`, { recursive: true });
    } catch {
      // ficheiro pode já não existir
    }
  }
}
