import { Outlet } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { AppMenu } from "./AppMenu";
import { useWorkspace } from "./WorkspaceContext";

export function Shell() {
  const { activeApp } = useWorkspace();

  if (!activeApp) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="flex min-h-0 min-w-0 flex-1">
        <AppMenu />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppHeader variant="workspace" />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
