import { FolderOpen } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChatLlmRoutingSelect } from "@/components/chat/ChatLlmRoutingSelect";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { saveDevStudioConversationProject } from "@/lib/devStudio/conversationProjectLink";
import { desktopPolvoCode, isElectron } from "@/lib/desktopApi";
import { saveDeskConversationPrefs } from "@/lib/deskConversationPrefs";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/** Selector workspace + modelo LLM (perfis SQLite + Ollama). */
export function DeskToolbar({ className }: Props) {
  const {
    activeConversationId,
    sending,
    llmSelectValue,
    setLlmSelectValue,
    llmProfiles,
  } = useConversationWorkspace();
  const { devStudioWorkspacePath, setDevStudioProject, openDevStudioPreview } = useWorkspace();
  const inElectron = isElectron();

  const workspaceLabel = devStudioWorkspacePath?.trim()
    ? devStudioWorkspacePath.replace(/\\/g, "/").split("/").pop() ?? devStudioWorkspacePath
    : "Sem workspace";

  const handleChooseFolder = useCallback(async () => {
    if (!inElectron) return;
    const r = await desktopPolvoCode.chooseProjectFolder();
    if (r.ok && "workspacePath" in r && r.workspacePath) {
      setDevStudioProject(r.workspacePath, null);
      openDevStudioPreview();
      const cid = activeConversationId;
      if (cid) {
        saveDevStudioConversationProject(cid, r.workspacePath, null);
        saveDeskConversationPrefs(cid, { workspacePath: r.workspacePath });
      }
    }
  }, [inElectron, setDevStudioProject, openDevStudioPreview, activeConversationId]);

  return (
    <div className={cn("ml-auto flex min-w-0 items-center gap-2", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {inElectron ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 max-w-[220px] gap-1.5 px-2 text-[11px]"
            title={devStudioWorkspacePath ?? "Escolher pasta do projecto"}
            disabled={sending}
            onClick={() => void handleChooseFolder()}
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">{workspaceLabel}</span>
          </Button>
        ) : (
          <span className="truncate text-[11px] text-muted-foreground" title={devStudioWorkspacePath ?? ""}>
            {workspaceLabel}
          </span>
        )}
      </div>
      <ChatLlmRoutingSelect
        value={llmSelectValue}
        onValueChange={setLlmSelectValue}
        profiles={llmProfiles}
        showOllama
        compact
        disabled={sending}
      />
    </div>
  );
}
