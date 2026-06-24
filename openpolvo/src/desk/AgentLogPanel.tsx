import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eraser, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  agentEventLabel,
  agentEventSummary,
  type AgentEventRecord,
} from "@/lib/agentEventTypes";
import { cn } from "@/lib/utils";
import { useAgentLogFromWorkspace } from "@/desk/useAgentLogFromWorkspace";

type ToolGroup = {
  id: string;
  call: AgentEventRecord;
  result: AgentEventRecord | null;
  others: AgentEventRecord[];
};

function groupEvents(events: AgentEventRecord[]): Array<AgentEventRecord | ToolGroup> {
  const out: Array<AgentEventRecord | ToolGroup> = [];
  let pendingCall: AgentEventRecord | null = null;
  let pendingOthers: AgentEventRecord[] = [];

  const flushCall = () => {
    if (!pendingCall) return;
    out.push({
      id: pendingCall.id,
      call: pendingCall,
      result: null,
      others: pendingOthers,
    });
    pendingCall = null;
    pendingOthers = [];
  };

  for (const ev of events) {
    if (ev.kind === "tool_call") {
      flushCall();
      pendingCall = ev;
      continue;
    }
    if (ev.kind === "tool_result" && pendingCall) {
      out.push({
        id: pendingCall.id,
        call: pendingCall,
        result: ev,
        others: pendingOthers,
      });
      pendingCall = null;
      pendingOthers = [];
      continue;
    }
    if (pendingCall) {
      pendingOthers.push(ev);
    } else {
      out.push(ev);
    }
  }
  flushCall();
  return out;
}

function payloadPreview(payload: Record<string, unknown>): string {
  try {
    const raw = JSON.stringify(payload, null, 2);
    return raw.length > 4000 ? `${raw.slice(0, 3997)}…` : raw;
  } catch {
    return String(payload);
  }
}

function ToolGroupRow({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(true);
  const title = agentEventSummary("tool_call", group.call.payload);

  return (
    <div className="rounded-lg border border-border/70 bg-card/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="font-medium text-foreground">{title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">tool</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
            {payloadPreview(group.call.payload)}
          </pre>
          {group.result ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-2 font-mono text-[10px] text-foreground/90">
              {payloadPreview(group.result.payload)}
            </pre>
          ) : (
            <p className="text-[10px] text-muted-foreground">À espera do resultado…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event }: { event: AgentEventRecord }) {
  const [open, setOpen] = useState(event.kind === "thought");
  const summary = agentEventSummary(event.kind, event.payload);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {agentEventLabel(event.kind)}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/90">{summary}</span>
      </button>
      {open ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-border/60 px-3 py-2 font-mono text-[10px] text-muted-foreground">
          {payloadPreview(event.payload)}
        </pre>
      ) : null}
    </div>
  );
}

/** Painel lateral de logs do agente (SSE agent_event). */
export function AgentLogPanel({ className }: { className?: string }) {
  const { events, clearEvents, autoScroll, setAutoScroll } = useAgentLogFromWorkspace();
  const bottomRef = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => groupEvents(events), [events]);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoScroll]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-border bg-muted/20",
        className,
      )}
      aria-label="Logs do agente"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <ScrollText className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Logs do agente</span>
        <span className="text-[10px] text-muted-foreground">({events.length})</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={autoScroll ? "secondary" : "ghost"}
            size="icon-sm"
            title={autoScroll ? "Auto-scroll activo" : "Auto-scroll desactivado"}
            aria-label="Alternar auto-scroll"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Limpar logs"
            aria-label="Limpar logs"
            disabled={events.length === 0}
            onClick={clearEvents}
          >
            <Eraser className="size-3.5" />
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Os passos do agente aparecem aqui durante uma resposta (thought, tools, observações).
            </p>
          ) : (
            grouped.map((item) =>
              "call" in item ? (
                <ToolGroupRow key={item.id} group={item} />
              ) : (
                <EventRow key={item.id} event={item} />
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </aside>
  );
}
