/**
 * @deprecated Usa `webContainerManager.ts` directamente.
 * Este ficheiro existe apenas para não quebrar importações residuais.
 */
export {
  destroyActiveContainer as teardownActiveWebContainer,
  getActivePreviewUrl,
  getMountedFiles,
  isContainerReady,
  WebContainerManager,
} from "@/lib/webContainerManager";

// Stubs para compatibilidade com código legado que importava estas funções
export function getActiveWebContainer(): null {
  return null;
}
export function getPersistedPreview(): {
  projectKey: string | null;
  previewUrl: string | null;
  files: null;
} {
  return { projectKey: null, previewUrl: null, files: null };
}
export function setPersistedPreview(): void {
  /* no-op: estado gerido internamente pelo WebContainerManager */
}
export function updatePersistedFiles(): void {
  /* no-op */
}
export async function bootWebContainerSerial(): Promise<never> {
  throw new Error("bootWebContainerSerial foi removido. Usa WebContainerManager.init().");
}
