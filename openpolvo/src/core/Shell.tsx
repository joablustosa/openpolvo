import { Outlet } from "react-router-dom";
import { AgentHomeHeader } from "./AgentHomeHeader";
import { AgentSidebar } from "./AgentSidebar";
import { AppHeader } from "./AppHeader";
import { AppMenu } from "./AppMenu";
import { ConversationWorkspaceProvider } from "./ConversationWorkspaceContext";
import { HomeChatProvider } from "./HomeChatContext";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Shell global: fornece os contextos de chat/workspace para todas as rotas
 * autenticadas. Com `activeApp` vazio, todas as rotas partilham o mesmo chrome
 * da home (sidebar + `AgentHomeHeader`). Com plugin activo, usa `AppMenu` +
 * `AppHeader` para o modo workspace.
 */
export function Shell() {
  const { activeApp, sidebarCollapsed, toggleSidebar } = useWorkspace();

  return (
    <HomeChatProvider>
      <ConversationWorkspaceProvider>
        {!activeApp ? (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              {!sidebarCollapsed ? <AgentSidebar /> : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <AgentHomeHeader
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={toggleSidebar}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        ) : (
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
        )}
      </ConversationWorkspaceProvider>
    </HomeChatProvider>
  );
}
