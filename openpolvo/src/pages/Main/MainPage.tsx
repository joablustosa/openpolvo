import { useState } from "react";
import { AgentHomeHeader } from "@/core/AgentHomeHeader";
import { AgentSidebar } from "@/core/AgentSidebar";
import { ConversationWorkspaceProvider } from "@/core/ConversationWorkspaceContext";
import { HomeChatProvider } from "@/core/HomeChatContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { HomePage } from "@/pages/Home/HomePage";
import { WorkspacePage } from "./WorkspacePage";

export function MainPage() {
  const { activeApp } = useWorkspace();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <HomeChatProvider>
      <ConversationWorkspaceProvider>
        {activeApp ? (
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <AgentSidebar />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <WorkspacePage />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row">
            {!sidebarCollapsed ? <AgentSidebar /> : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <AgentHomeHeader
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
              />
              <HomePage />
            </div>
          </div>
        )}
      </ConversationWorkspaceProvider>
    </HomeChatProvider>
  );
}
