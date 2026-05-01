import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useWorkspaceLayout } from "@/core/WorkspaceLayoutContext";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "smartagent_chat_width";
const MIN = 280;
const MAX_RATIO = 0.72;

type Props = {
  chat: ReactNode;
  site: ReactNode;
  className?: string;
};

export function ResizableChatLayout({ chat, site, className }: Props) {
  const { rightPanelCollapsed, expandRightPanel } = useWorkspaceLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(420);
  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof localStorage === "undefined") return 420;
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v >= MIN ? v : 420;
  });
  widthRef.current = chatWidth;

  const onMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    const rect = el.getBoundingClientRect();
    const max = rect.width * MAX_RATIO;
    const next = Math.min(
      max,
      Math.max(MIN, drag.startW + (e.clientX - drag.startX)),
    );
    setChatWidth(next);
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", endDrag);
    localStorage.setItem(STORAGE_KEY, String(widthRef.current));
  }, [onMove]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: widthRef.current };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", endDrag);
    },
    [endDrag, onMove],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endDrag);
    };
  }, [onMove, endDrag]);

  if (rightPanelCollapsed) {
    return (
      <div
        className={cn("flex h-full min-h-0 w-full flex-1", className)}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          {chat}
        </div>
        <button
          type="button"
          onClick={expandRightPanel}
          title="Mostrar área de trabalho"
          aria-label="Mostrar painel direito da área de trabalho"
          className={cn(
            "flex h-full min-w-0 shrink-0 flex-col items-center justify-center gap-1 border-l border-border",
            "bg-muted/40 px-1 py-4 text-muted-foreground transition-colors",
            "hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          <span className="max-w-[2rem] select-none text-center text-[10px] font-medium leading-tight">
            Área
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full min-h-0 w-full flex-1", className)}
    >
      <div
        className="flex min-h-0 shrink-0 flex-col border-r border-border bg-background"
        style={{ width: chatWidth }}
      >
        {chat}
      </div>
      <button
        type="button"
        aria-label="Redimensionar painéis"
        className="group relative w-1 shrink-0 cursor-col-resize border-0 bg-border p-0 transition-colors hover:bg-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={startDrag}
      >
        <span className="absolute inset-y-0 -left-1 -right-1" />
      </button>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/20">
        {site}
      </div>
    </div>
  );
}
