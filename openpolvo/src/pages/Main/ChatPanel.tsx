import { FormEvent, useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { useState } from "react";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { OctopusTypingLoader } from "@/components/brand/OctopusTypingLoader";
import { FormattedMessageContent } from "@/components/chat/FormattedMessageContent";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const {
    messages,
    sending,
    loadingMessages,
    error,
    modelProvider,
    setModelProvider,
    sendAuthenticatedMessage,
  } = useConversationWorkspace();

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  function send(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t || sending) return;
    setDraft("");
    void sendAuthenticatedMessage(t);
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background"
      aria-label="Conversa com Zé Polvinho"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Zé Polvinho</h2>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setModelProvider("openai")}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              modelProvider === "openai"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            OpenAI
          </button>
          <button
            type="button"
            onClick={() => setModelProvider("google")}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              modelProvider === "google"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Gemini
          </button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 px-4">
        <div className="flex flex-col gap-3 py-4" role="log">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {loadingMessages ? (
            <p className="text-sm text-muted-foreground">A carregar mensagens…</p>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[min(92%,560px)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                m.role === "assistant"
                  ? "self-start border border-border bg-card text-card-foreground"
                  : m.role === "system"
                    ? "self-center border border-dashed border-border/80 bg-muted/30 text-muted-foreground"
                    : "self-end border border-primary/25 bg-primary/10 text-foreground",
              )}
            >
              <FormattedMessageContent
                content={m.content}
                variant={
                  m.role === "assistant" || m.role === "system"
                    ? "rich"
                    : "plain"
                }
              />
            </div>
          ))}
          {sending ? <OctopusTypingLoader active /> : null}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        className="shrink-0 border-t border-border bg-card/50 p-3"
        onSubmit={send}
      >
        <div className="flex gap-2">
          <Textarea
            rows={2}
            placeholder="Responder…"
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[52px] resize-none border-border/80 bg-background"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="h-[52px] w-11 shrink-0"
            disabled={sending || !draft.trim()}
          >
            <SendHorizontal className="size-4" />
            <span className="sr-only">Enviar</span>
          </Button>
        </div>
      </form>
    </section>
  );
}
