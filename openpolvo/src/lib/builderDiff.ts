/**
 * Utilitários de diff entre snapshots do Builder.
 * Usados pelo chip de artefacto (chat) e pelo painel de código (BuilderPanel).
 */
import type { BuilderData } from "@/lib/builderMetadata";

export type FileDiff = {
  added: number;
  changed: number;
  removed: number;
};

/**
 * Compara dois snapshots de ficheiros e devolve o diff compacto.
 * `prev = null` significa que é o primeiro snapshot (criação do projecto).
 */
export function computeBuilderDiff(
  prev: BuilderData | null,
  curr: BuilderData,
): FileDiff {
  if (!prev) {
    // Primeiro snapshot — todos os ficheiros são "criados"
    return { added: curr.files.length, changed: 0, removed: 0 };
  }

  const prevMap = new Map(prev.files.map((f) => [f.path, f.content]));
  const currPaths = new Set(curr.files.map((f) => f.path));

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const f of curr.files) {
    if (!prevMap.has(f.path)) {
      added++;
    } else if (prevMap.get(f.path) !== f.content) {
      changed++;
    }
  }

  for (const f of prev.files) {
    if (!currPaths.has(f.path)) removed++;
  }

  return { added, changed, removed };
}

/**
 * Calcula os conjuntos de paths para highlight na árvore de ficheiros.
 * Retorna `null` se não houver mudanças.
 */
export function computeBuilderPathSets(
  prev: BuilderData | null,
  curr: BuilderData,
): { added: Set<string>; changed: Set<string>; removed: Set<string> } | null {
  if (!prev) return null;

  const prevMap = new Map(prev.files.map((f) => [f.path, f.content]));
  const currPaths = new Set(curr.files.map((f) => f.path));

  const added = new Set<string>();
  const changed = new Set<string>();
  const removed = new Set<string>();

  for (const f of curr.files) {
    if (!prevMap.has(f.path)) added.add(f.path);
    else if (prevMap.get(f.path) !== f.content) changed.add(f.path);
  }

  for (const f of prev.files) {
    if (!currPaths.has(f.path)) removed.add(f.path);
  }

  if (added.size === 0 && changed.size === 0 && removed.size === 0) return null;
  return { added, changed, removed };
}
