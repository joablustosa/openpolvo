import { useAuth } from "@/auth/AuthContext";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel";
import { useWorkspace } from "@/core/WorkspaceContext";
import { HomePage } from "@/pages/Home/HomePage";
import { WorkspacePage } from "./WorkspacePage";

export function MainPage() {
  const { token } = useAuth();
  const { dashboardData, setDashboardData } = useWorkspace();

  // Sessão autenticada: layout estável (chat + painel opcional) — evita remount
  // HomePage ↔ WorkspacePage que quebra o React (removeChild / providers).
  // Visitante: HomePage centralizada.
  if (token) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspacePage />
      </div>
    );
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
