import { useEffect } from "react";
import { ResizableChatLayout } from "@/core/ResizableChatLayout";
import { useWorkspace } from "@/core/WorkspaceContext";
import {
  useWorkspaceLayout,
  WorkspaceLayoutProvider,
} from "@/core/WorkspaceLayoutContext";
import { DeskModeProvider } from "@/desk/DeskModeContext";
import { DeskShell } from "@/desk/DeskShell";
import { isDeskMvpMode } from "@/lib/deskMvpMode";
import { ChatPanel } from "./ChatPanel";
import { SitePanel } from "./SitePanel";

/** Colapsa o painel direito quando não há preview/plugin; expande quando há. */
function WorkspaceLayoutSync() {
  const {
    activeApp,
    taskListsPreviewOpen,
    devStudioPreviewOpen,
    dashboardData,
  } = useWorkspace();
  const { rightPanelCollapsed, collapseRightPanel, expandRightPanel } =
    useWorkspaceLayout();

  useEffect(() => {
    const showRight =
      Boolean(activeApp) ||
      taskListsPreviewOpen ||
      devStudioPreviewOpen ||
      Boolean(dashboardData);
    if (showRight && rightPanelCollapsed) {
      expandRightPanel();
    } else if (!showRight && !rightPanelCollapsed) {
      collapseRightPanel();
    }
  }, [
    activeApp,
    taskListsPreviewOpen,
    devStudioPreviewOpen,
    dashboardData,
    rightPanelCollapsed,
    collapseRightPanel,
    expandRightPanel,
  ]);

  return null;
}

export function WorkspacePage() {
  if (isDeskMvpMode()) {
    return (
      <DeskModeProvider>
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <DeskShell />
        </div>
      </DeskModeProvider>
    );
  }

  return (
    <WorkspaceLayoutProvider>
      <WorkspaceLayoutSync />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ResizableChatLayout chat={<ChatPanel />} site={<SitePanel />} />
      </div>
    </WorkspaceLayoutProvider>
  );
}
