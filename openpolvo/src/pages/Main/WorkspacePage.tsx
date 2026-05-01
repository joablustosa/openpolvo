import { ResizableChatLayout } from "@/core/ResizableChatLayout";
import { WorkspaceLayoutProvider } from "@/core/WorkspaceLayoutContext";
import { ChatPanel } from "./ChatPanel";
import { SitePanel } from "./SitePanel";

export function WorkspacePage() {
  return (
    <WorkspaceLayoutProvider>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <ResizableChatLayout chat={<ChatPanel />} site={<SitePanel />} />
      </div>
    </WorkspaceLayoutProvider>
  );
}
