import { ChatPanel } from "@/pages/Main/ChatPanel";
import { AgentLogPanel } from "./AgentLogPanel";

/** Agent Mode — chat + painel de logs SSE. */
export function AgentModeShell() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatPanel variant="desk" />
      </div>
      <AgentLogPanel className="hidden w-80 shrink-0 lg:flex" />
    </div>
  );
}
