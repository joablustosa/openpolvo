import { Outlet } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { AppMenu } from "./AppMenu";
import { ConversationWorkspaceProvider } from "./ConversationWorkspaceContext";
import { HomeChatProvider } from "./HomeChatContext";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Shell global: fornece os contextos de chat/workspace para todas as rotas
 * autenticadas. Isto permite que páginas irmãs (tarefas, pulo do gato,
 * definições) reutilizem o mesmo topbar (`AgentHomeHeader`) com os menus,
 * ícones e atalhos da página inicial.
 */
export function Shell() {
  const { activeApp } = useWorkspace();

  return (
    <HomeChatProvider>
      <ConversationWorkspaceProvider>
        {!activeApp ? (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
            <Outlet />
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
