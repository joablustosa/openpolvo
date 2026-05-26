import { useAuth } from "@/auth/AuthContext";
import type { AppId } from "@/config/apps";
import { getPluginUrl, isNativePluginApp } from "@/config/apps";
import { useWorkspace } from "@/core/WorkspaceContext";

export function useAppLaunch() {
  const { setTargetUrl } = useAuth();
  const { setActiveApp, clearDevStudio, openDevStudioPreview, closeDevStudioPreview } =
    useWorkspace();

  const openPlugin = (id: AppId) => {
    if (isNativePluginApp(id)) {
      setTargetUrl("");
      openDevStudioPreview();
      return;
    }
    setTargetUrl(getPluginUrl(id));
    setActiveApp(id);
  };

  const openSmartBus = () => openPlugin("smartbus");

  const goHome = () => {
    setTargetUrl("");
    closeDevStudioPreview();
    clearDevStudio();
    setActiveApp(null);
  };

  return { openPlugin, openSmartBus, goHome };
}
