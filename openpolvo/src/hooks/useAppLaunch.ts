import { useAuth } from "@/auth/AuthContext";
import type { AppId } from "@/config/apps";
import { getPluginUrl } from "@/config/apps";
import { useWorkspace } from "@/core/WorkspaceContext";

export function useAppLaunch() {
  const { setTargetUrl } = useAuth();
  const { setActiveApp } = useWorkspace();

  const openPlugin = (id: AppId) => {
    setTargetUrl(getPluginUrl(id));
    setActiveApp(id);
  };

  const openSmartBus = () => openPlugin("smartbus");

  const goHome = () => {
    setTargetUrl("");
    setActiveApp(null);
  };

  return { openPlugin, openSmartBus, goHome };
}
