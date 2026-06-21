import { useAuth } from "@/auth/AuthContext";
import type { AppId } from "@/config/apps";
import { getPluginUrl, isNativePluginApp } from "@/config/apps";
import { useDeskModeOptional } from "@/desk/DeskModeContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { isDeskMvpMode } from "@/lib/deskMvpMode";

export function useAppLaunch() {
  const { setTargetUrl } = useAuth();
  const deskMode = useDeskModeOptional();
  const { setActiveApp, clearDevStudio, openDevStudioPreview, closeDevStudioPreview } =
    useWorkspace();

  const openPlugin = (id: AppId) => {
    if (isNativePluginApp(id)) {
      setTargetUrl("");
      openDevStudioPreview();
      if (isDeskMvpMode()) {
        deskMode?.setMode("code");
      }
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
