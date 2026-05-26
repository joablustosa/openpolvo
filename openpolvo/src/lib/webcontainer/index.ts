export {
  applyOpsInWebContainer,
  getWebContainerPreviewService,
  WebContainerPreviewService,
} from "./webContainerPreviewService";
export { applyOpsInWebContainerWithSelfHeal } from "./selfHealLoop";
export {
  applyOpsToVirtualFiles,
  ensureRunnableViteProject,
  flatFilesToFileSystemTree,
  virtualFilesFromOps,
} from "./opsToFileTree";
export {
  isWebContainerSupported,
  isWebContainerWorkspace,
  WEBCONTAINER_WORKSPACE_ID,
  type MountProjectOptions,
  type VirtualProjectFiles,
  type WebContainerPreviewEvent,
  type WebContainerPreviewPhase,
} from "./types";
