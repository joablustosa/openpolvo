import { FolderOpen } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { saveDevStudioConversationProject } from "@/lib/devStudio/conversationProjectLink";
import { desktopPolvoCode, isElectron } from "@/lib/desktopApi";
import type { DeskModelProvider } from "@/lib/deskContext";
import {
  saveDeskConversationPrefs,
} from "@/lib/deskConversationPrefs";
import { cn } from "@/lib/utils";
import { DeskModelSelect } from "./DeskModelSelect";

type Props = {
  modelProvider: DeskModelProvider;
  onModelProviderChange: (v: DeskModelProvider) => void;
  className?: string;
};

/** Selector workspace + modelo (DESK-14). */
export function DeskToolbar({ modelProvider, onModelProviderChange, className }: Props) {
  const { activeConversationId, sending } = useConversationWorkspace();
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
      <DeskModelSelect
        value={modelProvider}
        onValueChange={onModelProviderChange}
        disabled={sending}
      />
    </div>
  );
}