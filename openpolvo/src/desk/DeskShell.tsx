import { useEffect } from "react";
import { Bot, Code2, GitBranch } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/core/WorkspaceContext";
import { ChatPanel } from "@/pages/Main/ChatPanel";
import { CodeModeShell } from "./CodeModeShell";
import { useDeskMode } from "./DeskModeContext";
import { FlowModeShell } from "./FlowModeShell";
import type { DeskMode } from "./types";

function isDeskMode(value: string): value is DeskMode {
  return value === "agent" || value === "code" || value === "flow";
}

/** Shell Desk MVP — tabs Agent / Code / Flow. */
export function DeskShell() {
  const { mode, setMode } = useDeskMode();
  const { devStudioPreviewOpen, devStudioWorkspacePath } = useWorkspace();

  useEffect(() => {
    if (devStudioPreviewOpen || devStudioWorkspacePath) {
      setMode("code");
    }
  }, [devStudioPreviewOpen, devStudioWorkspacePath, setMode]);

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (isDeskMode(value)) setMode(value);
      }}
      className="flex h-full min-h-0 flex-col gap-0 overflow-hidden"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border bg-card/60 px-3">
        <TabsList variant="line" className="h-8">
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
            title="Em breve"
            className="gap-1.5 px-3"
          >
            <GitBranch className="size-3.5" />
            Flow
          </TabsTrigger>
        </TabsList>
      </header>

      <TabsContent
        value="agent"
        className="mt-0 min-h-0 flex-1 overflow-hidden data-active:flex data-active:flex-col"
      >
        <ChatPanel />
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
