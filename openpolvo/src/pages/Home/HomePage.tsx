import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useAnonymousChat } from "@/core/AnonymousChatContext";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useHomeChatControls } from "@/core/HomeChatContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { findLatestBuilderDataInMessages } from "@/lib/builderMetadata";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OctopusTypingLoader } from "@/components/brand/OctopusTypingLoader";
import { FormattedMessageContent } from "@/components/chat/FormattedMessageContent";
import { ChatLlmRoutingSelect } from "@/components/chat/ChatLlmRoutingSelect";
import { transcribeAudio } from "@/lib/audioApi";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { displayNameFromToken } from "@/lib/userDisplay";
import { cn } from "@/lib/utils";

type HomePillId = "conversa" | "criar_automacao" | "criar_imagem" | "enviar_imagem";

const HOME_PILLS: {
  id: HomePillId;
  label: string;
  icon: typeof MessageCircle;
  disabled?: boolean;
  title?: string;
}[] = [
  { id: "conversa", label: "Conversa", icon: MessageCircle },
  { id: "criar_automacao", label: "Criar automação", icon: Zap },
  {
    id: "criar_imagem",
    label: "Criar imagem (em andamento)",
    icon: Sparkles,
    disabled: true,
    title: "Em breve",
  },
  {
    id: "enviar_imagem",
    label: "Enviar imagem",
    icon: ImageIcon,
    disabled: true,
    title: "Em breve",
  },
];

type GuestMsg = { id: string; role: "user" | "assistant"; text: string };

const initialGuestMessages = (): GuestMsg[] => [
  {
    id: "welcome",
    role: "assistant",
    text:
      "Olá. Pode enviar até duas mensagens como visitante; depois será pedido o login para continuar com o Zé Polvinho.",
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [activePill, setActivePill] = useState<HomePillId>("conversa");
  const { registerReset } = useHomeChatControls();
  const { canSendAsAnonymous, afterAnonymousUserMessage } = useAnonymousChat();
  const workspace = useConversationWorkspace();
  const { clearWorkspace } = workspace;
  const { setBuilderData } = useWorkspace();

  const [guestMessages, setGuestMessages] = useState<GuestMsg[]>(
    initialGuestMessages,
  );
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerReset(() => {
      setGuestMessages(initialGuestMessages());
      setDraft("");
      setActivePill("conversa");
      clearWorkspace();
    });
  }, [registerReset, clearWorkspace]);

  const authWelcomeText = useMemo(
    () =>
      "Conversa com **Zé Polvinho** (motor Go). Escolha **Automático**, **OpenAI**, **Gemini** ou um **perfil** com chave (em Definições → Modelos LLM). A primeira mensagem cria a conversa se ainda não houver uma activa.\n\nAs respostas usam **Markdown** (títulos, listas, código e links).",
    [],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [token, guestMessages, workspace.messages, workspace.sending]);

  const displayName = displayNameFromToken(token);
  const greeting = token ? `${displayName} está de volta!` : "Bem-vindo!";

  const savedConversationProject = useMemo(() => {
    if (
      !token ||
      !workspace.activeConversationId ||
      workspace.loadingMessages
    ) {
      return null;
    }
    return findLatestBuilderDataInMessages(workspace.messages);
  }, [
    token,
    workspace.activeConversationId,
    workspace.loadingMessages,
    workspace.messages,
  ]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;

    if (token) {
      void (async () => {
        await workspace.sendAuthenticatedMessage(t);
        setDraft("");
      })();
      return;
    }

    if (!canSendAsAnonymous()) return;

    setGuestMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: t },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          "Resposta simulada. Inicie sessão para conversar com o Zé Polvinho na API.",
      },
    ]);
    setDraft("");
    afterAnonymousUserMessage();
  }

  const submitting = token ? workspace.sending : false;

  const tokenRef = useRef(token);
  tokenRef.current = token;
  const transcribe = useCallback(
    (blob: Blob) =>
      transcribeAudio(tokenRef.current, blob, workspace.transcribeModelProvider),
    [workspace.transcribeModelProvider],
  );
  const { state: micState, error: micError, toggle: toggleMic } = useAudioRecorder({
    transcribe,
    onTranscriptAutoSend: (text) => workspace.sendAuthenticatedMessage(text),
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col px-4 pb-6 pt-10">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-[#d97757]" aria-hidden />
              <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
                {greeting}
              </h1>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              {token
                ? "Zé Polvinho encaminha o pedido para o especialista certo (pedidos, informação ou geral)."
                : "Até duas perguntas em modo visitante; depois, inicie sessão para continuar."}
            </p>
          </div>

          {token && workspace.error ? (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {workspace.error}
            </p>
          ) : null}

          {token && savedConversationProject ? (
            <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary/90">
                    Projecto nesta conversa
                  </p>
                  <p className="truncate font-medium text-foreground">
                    {savedConversationProject.title}
                  </p>
                  {savedConversationProject.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {savedConversationProject.description}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => setBuilderData(savedConversationProject)}
                >
                  <Eye className="size-3.5" aria-hidden />
                  Abrir preview
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 pb-4" role="log">
            {token ? (
              <>
                {workspace.messages.length === 0 &&
                !workspace.loadingMessages ? (
                  <div className="max-w-[min(92%,560px)] self-start rounded-2xl border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-card-foreground">
                    <FormattedMessageContent
                      content={authWelcomeText}
                      variant="rich"
                    />
                  </div>
                ) : null}
                {workspace.loadingMessages ? (
                  <p className="text-sm text-muted-foreground">
                    A carregar mensagens…
                  </p>
                ) : null}
                {workspace.messages.map((m) => (
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
                {token && workspace.sending ? (
                  <OctopusTypingLoader active />
                ) : null}
              </>
            ) : (
              guestMessages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[min(92%,560px)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "assistant"
                      ? "self-start border border-border bg-card text-card-foreground"
                      : "self-end border border-primary/25 bg-primary/10 text-foreground",
                  )}
                >
                  <FormattedMessageContent
                    content={m.text}
                    variant={m.role === "assistant" ? "rich" : "plain"}
                  />
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <form
          onSubmit={onSubmit}
          className="mx-auto w-full max-w-3xl rounded-2xl border border-border/80 bg-card/80 p-2 shadow-lg ring-1 ring-foreground/5 backdrop-blur-sm"
        >
          <div className="relative rounded-xl bg-muted/30">
            {micError ? (
              <p className="px-4 pt-2 text-xs text-destructive">{micError}</p>
            ) : null}
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                micState === "recording"
                  ? "A ouvir… fale; ao calar ou ao clicar no microfone a mensagem é enviada"
                  : micState === "processing"
                    ? "A transcrever…"
                    : "Como posso ajudar você hoje?"
              }
              disabled={submitting}
              className={cn(
                "min-h-[100px] resize-none border-0 bg-transparent px-12 py-4 text-base shadow-none focus-visible:ring-0",
                "placeholder:text-muted-foreground/70",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
            />
            <div className="pointer-events-none absolute left-3 top-3">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="pointer-events-auto text-muted-foreground"
                aria-label="Anexar"
                disabled
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <div className="absolute bottom-3 right-3 flex flex-wrap items-center justify-end gap-1">
              {token ? (
                <ChatLlmRoutingSelect
                  value={workspace.llmSelectValue}
                  onValueChange={workspace.setLlmSelectValue}
                  profiles={workspace.llmProfiles}
                  disabled={submitting}
                />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-full border-border/80 bg-background/80 text-xs"
                disabled
              >
                <Paperclip className="size-3.5 opacity-70" />
                Anexos
              </Button>
              {token ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant={micState === "recording" ? "destructive" : "ghost"}
                  className={cn(micState !== "recording" && "text-muted-foreground")}
                  aria-label={micState === "recording" ? "Parar gravação" : "Gravar voz (Jarvis)"}
                  disabled={submitting || micState === "processing"}
                  onClick={toggleMic}
                  title={
                    micState === "recording"
                      ? "Parar e enviar transcrição"
                      : "Falar: termina ao silêncio ou ao clicar de novo"
                  }
                >
                  {micState === "recording" ? (
                    <MicOff className="size-4" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label="Voz"
                  disabled
                >
                  <Mic className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {HOME_PILLS.map((p) => {
              const Icon = p.icon;
              const selected = activePill === p.id;
              return (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={selected ? "secondary" : "outline"}
                  disabled={Boolean(p.disabled)}
                  title={p.title}
                  className={cn(
                    "h-auto min-h-8 gap-1.5 rounded-full px-3 py-1.5 text-xs font-normal",
                    p.disabled && "pointer-events-auto",
                  )}
                  onClick={() => {
                    if (p.disabled) return;
                    if (p.id === "conversa") {
                      setActivePill("conversa");
                      return;
                    }
                    if (p.id === "criar_automacao") {
                      setActivePill("criar_automacao");
                      navigate("/automacoes");
                    }
                  }}
                >
                  <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  {p.label}
                </Button>
              );
            })}
          </div>
        </form>
      </div>
    </div>
  );
}
