import { useConversationWorkspaceOptional } from "@/core/ConversationWorkspaceContext";

export function useAgentLogFromWorkspace() {
  const ws = useConversationWorkspaceOptional();
  if (!ws) {
    return {
      events: [],
      clearEvents: () => {},
      autoScroll: true,
      setAutoScroll: () => {},
    };
  }
  return {
    events: ws.agentLogEvents,
    clearEvents: ws.clearAgentLog,
    autoScroll: ws.agentLogAutoScroll,
    setAutoScroll: ws.setAgentLogAutoScroll,
  };
}
