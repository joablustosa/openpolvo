import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Radio, SendHorizontal } from "lucide-react";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { OctopusTypingLoader } from "@/components/brand/OctopusTypingLoader";
import { EmailDraftActions } from "@/components/chat/EmailDraftActions";
import { FormattedMessageContent } from "@/components/chat/FormattedMessageContent";
import { useAuth } from "@/auth/AuthContext";
import { parseEmailMessageMeta } from "@/lib/emailChatMetadata";
import { transcribeAudio } from "@/lib/audioApi";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import {
  readVoiceWakePreference,
  useJowWakeListener,
  writeVoiceWakePreference,
  type WakePayload,
} from "@/hooks/useJowWakeListener";
import { useRecordUntilSilence } from "@/hooks/useRecordUntilSilence";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const { token } = useAuth();
  const { taskListsPreviewOpen } = useWorkspace();
  const {
    messages,
    sending,
    loadingMessages,
    error,
    emailSendNotice,
    clearEmailSendNotice,
    taskListNotice,
    clearTaskListNotice,
    modelProvider,
    setModelProvider,
    sendAuthenticatedMessage,
    activeConversationId,
    selectConversation,
  } = useConversationWorkspace();

  const [draft, setDraft] = useState("");
  const [voiceWakeEnabled, setVoiceWakeEnabled] = useState(readVoiceWakePreference);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    writeVoiceWakePreference(voiceWakeEnabled);
  }, [voiceWakeEnabled]);

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

  const tokenRef = useRef(token);
  tokenRef.current = token;
  const transcribe = useCallback(
    (blob: Blob) => transcribeAudio(tokenRef.current, blob, modelProvider),
    [modelProvider],
  );
  const { state: micState, error: micError, toggle: toggleMic } = useAudioRecorder({
    transcribe,
    onTranscriptAutoSend: sendAuthenticatedMessage,
  });

  const { record: recordUntilSilence, abort: abortWakeRecord } = useRecordUntilSilence();

  const wakeActive = Boolean(
    token &&
      voiceWakeEnabled &&
      !sending &&
      !wakeBusy &&
      micState === "idle" &&
      !loadingMessages &&
      !taskListsPreviewOpen,
  );

  const onWake = useCallback(
    (p: WakePayload) => {
      if (!token || sending) return;
      setWakeBusy(true);
      setWakeError(null);
      void (async () => {
        try {
          if (p.kind === "inline") {
            const t = p.text.trim();
            if (t) await sendAuthenticatedMessage(t);
            return;
          }
          const blob = await recordUntilSilence();
          const text = (await transcribe(blob)).trim();
          if (text) await sendAuthenticatedMessage(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro no pedido por voz";
          if (msg !== "Gravação cancelada") setWakeError(msg);
        } finally {
          setWakeBusy(false);
        }
      })();
    },
    [token, sending, recordUntilSilence, transcribe, sendAuthenticatedMessage],
  );

  const { supported: wakeSupported, listening: wakeListening, speechError: wakeSpeechError } =
    useJowWakeListener({
      active: wakeActive,
      onWake,
    });

  useEffect(() => {
    return () => abortWakeRecord();
  }, [abortWakeRecord]);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background"
      aria-label="Conversa com Zé Polvinho"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Zé Polvinho</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            disabled={!token || !wakeSupported}
            title={
              !wakeSupported
                ? "Reconhecimento de voz não disponível neste ambiente"
                : voiceWakeEnabled
                  ? "Desligar escuta contínua «jow na escuta?»"
                  : "Ligar escuta contínua «jow na escuta?»"
            }
            onClick={() => setVoiceWakeEnabled((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              !token || !wakeSupported
                ? "cursor-not-allowed opacity-50"
                : voiceWakeEnabled
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Radio className={cn("size-3", wakeListening && voiceWakeEnabled && "animate-pulse")} />
            Jow na escuta
          </button>
          {wakeListening && voiceWakeEnabled && wakeSupported ? (
            <span className="text-[10px] text-muted-foreground">a ouvir…</span>
          ) : null}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 px-4">
        <div className="flex flex-col gap-3 py-4" role="log">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {emailSendNotice ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              <span>{emailSendNotice}</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0" onClick={clearEmailSendNotice}>
                OK
              </Button>
            </div>
          ) : null}
          {taskListNotice ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
              <span>{taskListNotice}</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0" onClick={clearTaskListNotice}>
                OK
              </Button>
            </div>
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
              {m.role === "assistant" && token && parseEmailMessageMeta(m.metadata)?.email_send_draft ? (
                <EmailDraftActions
                  token={token}
                  messageId={m.id}
                  metadata={m.metadata}
                  onSent={() => {
                    if (activeConversationId) {
                      void selectConversation(activeConversationId);
                    }
                  }}
                />
              ) : null}
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
        {micError || wakeSpeechError || wakeError ? (
          <p className="mb-2 text-xs text-destructive">
            {[micError, wakeSpeechError, wakeError].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Textarea
            rows={2}
            placeholder={
              wakeBusy
                ? "Pedido por voz…"
                : micState === "recording"
                  ? "A ouvir… fale; ao calar ou ao clicar no microfone a mensagem é enviada"
                  : micState === "processing"
                    ? "A transcrever…"
                    : "Responder…"
            }
            value={draft}
            disabled={sending || wakeBusy}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[52px] resize-none border-border/80 bg-background"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
            }}
          />
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button
              type="button"
              size="icon"
              variant={micState === "recording" ? "destructive" : "outline"}
              className="h-[24px] w-11"
              disabled={sending || micState === "processing" || wakeBusy}
              onClick={toggleMic}
              title={
                micState === "recording"
                  ? "Parar e enviar transcrição"
                  : "Falar: termina ao silêncio ou ao clicar de novo"
              }
            >
              {micState === "recording" ? (
                <MicOff className="size-3.5" />
              ) : (
                <Mic className="size-3.5" />
              )}
            </Button>
            <Button
              type="submit"
              size="icon"
              className="h-[24px] w-11"
              disabled={sending || !draft.trim()}
            >
              <SendHorizontal className="size-4" />
              <span className="sr-only">Enviar</span>
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
