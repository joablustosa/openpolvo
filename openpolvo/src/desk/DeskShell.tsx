import { useEffect } from "react";
import { Bot, Code2, GitBranch } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import type { DeskModelProvider } from "@/lib/deskContext";
import {
  getDeskConversationPrefs,
  saveDeskConversationPrefs,
} from "@/lib/deskConversationPrefs";
import { getDevStudioConversationProject } from "@/lib/devStudio/conversationProjectLink";
import { AgentModeShell } from "./AgentModeShell";
import { CodeModeShell } from "./CodeModeShell";
import { DeskToolbar } from "./DeskToolbar";
import { useDeskMode } from "./DeskModeContext";
import { FlowModeShell } from "./FlowModeShell";
import type { DeskMode } from "./types";

function isDeskMode(value: string): value is DeskMode {
  return value === "agent" || value === "code" || value === "flow";
}

/** Shell Desk MVP — tabs Agent / Code / Flow + toolbar workspace/modelo. */
export function DeskShell() {
  const { mode, setMode, modelProvider, setModelProvider } = useDeskMode();
  const { devStudioPreviewOpen, devStudioWorkspacePath, setDevStudioProject } = useWorkspace();
  const { activeConversationId } = useConversationWorkspace();

  useEffect(() => {
    if (devStudioPreviewOpen || devStudioWorkspacePath) {
      setMode("code");
    }
  }, [devStudioPreviewOpen, devStudioWorkspacePath, setMode]);

  useEffect(() => {
    const cid = activeConversationId;
    if (!cid) return;
    const prefs = getDeskConversationPrefs(cid);
    if (prefs?.modelProvider) {
      setModelProvider(prefs.modelProvider);
    }
    const linked = getDevStudioConversationProject(cid);
    const wp = prefs?.workspacePath ?? linked?.workspacePath ?? null;
    if (wp) {
      setDevStudioProject(wp, linked?.title ?? null);
    }
  }, [activeConversationId, setModelProvider, setDevStudioProject]);

  const handleModelChange = (next: DeskModelProvider) => {
    setModelProvider(next);
    if (activeConversationId) {
      saveDeskConversationPrefs(activeConversationId, { modelProvider: next });
    }
  };

  return (
    <Tabs
        value={mode}
        onValueChange={(value) => {
          if (isDeskMode(value)) setMode(value);
        }}
        className="flex h-full min-h-0 flex-col gap-0 overflow-hidden"
      >
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-3">
          <TabsList variant="line" className="h-8 shrink-0">
            <TabsTrigger value="agent" className="gap-1.5 px-3">
              <Bot className="size-3.5" />
              Agente
            </TabsTrigger>
            <TabsTrigger value="code" className="gap-1.5 px-3">
              <Code2 className="size-3.5" />
              Código
            </TabsTrigger>
          <TabsTrigger
            value="flow"
            disabled
            title="Em breve — automações visuais"
            className="gap-1.5 px-3"
          >
            <GitBranch className="size-3.5" />
            Flow
          </TabsTrigger>
          </TabsList>
          <DeskToolbar modelProvider={modelProvider} onModelProviderChange={handleModelChange} />
        </header>

        <TabsContent
          value="agent"
          className="mt-0 min-h-0 flex-1 overflow-hidden data-active:flex data-active:flex-col"
        >
          <AgentModeShell />
        </TabsContent>
        <TabsContent
          value="code"
          className="mt-0 min-h-0 flex-1 overflow-hidden data-active:flex data-active:flex-col"
        >
          <CodeModeShell />
        </TabsContent>
        <TabsContent
          value="flow"
          className="mt-0 min-h-0 flex-1 overflow-hidden data-active:flex data-active:flex-col"
        >
          <FlowModeShell />
        </TabsContent>
      </Tabs>
  );
}
