import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { installDevStudioPreviewBus } from "@/lib/devStudioPreviewBus";
import { isElectron } from "@/lib/desktopApi";
import { AgentHomeHeader } from "./AgentHomeHeader";
import { AgentSidebar } from "./AgentSidebar";
import { AppHeader } from "./AppHeader";
import { AppMenu } from "./AppMenu";
import { ConversationWorkspaceProvider } from "./ConversationWorkspaceContext";
import { DeskModeProvider } from "@/desk/DeskModeContext";
import { HomeChatProvider } from "./HomeChatContext";
import { isDeskMvpMode } from "@/lib/deskMvpMode";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Shell global: fornece os contextos de chat/workspace para todas as rotas
 * autenticadas. Com `activeApp` vazio, todas as rotas partilham o mesmo chrome
 * da home (sidebar + `AgentHomeHeader`). Com plugin activo, usa `AppMenu` +
 * `AppHeader` para o modo workspace.
 */
export function Shell() {
  const { activeApp, sidebarCollapsed, toggleSidebar } = useWorkspace();

  useEffect(() => {
    if (!isElectron()) return;
    return installDevStudioPreviewBus();
  }, []);

  const workspaceInner = (
    <ConversationWorkspaceProvider>
      {!activeApp ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
              <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
              {!sidebarCollapsed ? <AgentSidebar /> : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <AgentHomeHeader
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={toggleSidebar}
                />
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <Outlet />
                </main>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <AppMenu />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <AppHeader variant="workspace" />
                <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <Outlet />
                </main>
              </div>
            </div>
          </div>
        )}
    </ConversationWorkspaceProvider>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <HomeChatProvider>
        {isDeskMvpMode() ? (
          <DeskModeProvider>{workspaceInner}</DeskModeProvider>
        ) : (
          workspaceInner
        )}
      </HomeChatProvider>
    </div>
  );
}
