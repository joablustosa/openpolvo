import { useState } from "react";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel";
import { AgentHomeHeader } from "@/core/AgentHomeHeader";
import { AgentSidebar } from "@/core/AgentSidebar";
import { useWorkspace } from "@/core/WorkspaceContext";
import { HomePage } from "@/pages/Home/HomePage";
import { WorkspacePage } from "./WorkspacePage";

export function MainPage() {
  const {
    activeApp,
    dashboardData,
    setDashboardData,
    builderData,
    builderProgress,
    builderStreamFiles,
    taskListsPreviewOpen,
  } = useWorkspace();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Modo workspace: app activa, builder, ou preview de listas ao lado do chat
  const showWorkspace =
    activeApp ||
    builderData ||
    builderProgress ||
    builderStreamFiles.length > 0 ||
    taskListsPreviewOpen;

  if (showWorkspace) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {!sidebarCollapsed ? <AgentSidebar /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AgentHomeHeader
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          />
          <WorkspacePage />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row">
      {!sidebarCollapsed ? <AgentSidebar /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AgentHomeHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        />
        {dashboardData ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <DashboardPanel
              data={dashboardData}
              onClose={() => setDashboardData(null)}
            />
          </div>
        ) : (
          <HomePage />
        )}
      </div>
    </div>
  );
}
