import { DashboardPanel } from "@/components/dashboard/DashboardPanel";
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

  // Modo workspace: app activa, builder, ou preview de listas ao lado do chat
  const showWorkspace =
    activeApp ||
    builderData ||
    builderProgress ||
    builderStreamFiles.length > 0 ||
    taskListsPreviewOpen;

  if (showWorkspace) {
    return <WorkspacePage />;
  }

  if (dashboardData) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardPanel
          data={dashboardData}
          onClose={() => setDashboardData(null)}
        />
      </div>
    );
  }

  return <HomePage />;
}
