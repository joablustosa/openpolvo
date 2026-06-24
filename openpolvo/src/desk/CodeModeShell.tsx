import { ChatPanel } from "@/pages/Main/ChatPanel";
import { DevStudioPanel } from "@/components/dev-studio/DevStudioPanel";

/** Code Mode Desk — editor + barra/painel do agente estilo Cursor. */
export function CodeModeShell() {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1">
        <DevStudioPanel variant="desk" />
      </div>
      <aside className="flex w-[min(100%,420px)] shrink-0 border-l border-border/70 bg-background">
        <ChatPanel variant="desk" />
      </aside>
    </div>
  );
}
