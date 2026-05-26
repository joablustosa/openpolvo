import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/auth/AuthContext";
import {
  type ConversationDTO,
  type MessageDTO,
  type ModelProvider,
  type StreamEvent,
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  fetchConversations,
  fetchMessages,
  pinConversation as apiPinConversation,
  streamMessage as apiStreamMessage,
  renameConversation as apiRenameConversation,
} from "@/lib/conversationsApi";
import {
  fetchLlmProfiles,
  type LlmProfileDTO,
} from "@/lib/llmProfilesApi";
import {
  defaultModelForNewConversation,
  parseLlmRoutingSelect,
  transcribeModelProvider,
} from "@/lib/llmRouting";
import { forceReloginRedirect } from "@/lib/api";
import {
  errorMessageIndicatesPolvointelUnauthorized,
  isApiUnauthorized,
  SessionReloginRedirected,
} from "@/lib/apiErrors";
import {
  buildEmailSendPayload,
  emailBodyLooksReadyForAutosend,
  parseEmailMessageMeta,
} from "@/lib/emailChatMetadata";
import { messageIndicatesTaskListInteraction, parseTaskListMessageMeta } from "@/lib/taskListChatMetadata";
import { applyTaskListBatch } from "@/lib/taskListsApi";
import { parseDashboardMeta } from "@/lib/dashboardMetadata";
import {
  applyDevStudioOpsFromMeta,
  devStudioApplyFailureMessage,
  messageIndicatesDevStudioInteraction,
  shouldApplyDevStudioFromMetadata,
  restoreDevStudioProjectFromMessages,
} from "@/lib/devStudioMetadata";
import { collectDevStudioChatPayload } from "@/lib/devStudioChatPayload";
import { tryOpenNativePluginFromMessages } from "@/lib/nativePluginMetadata";
import { useAppLaunch } from "@/hooks/useAppLaunch";
import { useWorkspace } from "@/core/WorkspaceContext";
import * as mail from "@/lib/mailApi";

type ConversationWorkspaceValue = {
  conversations: ConversationDTO[];
  activeConversationId: string | null;
  messages: MessageDTO[];
  /** Selecção do chat: `auto`, `openai`, `google` ou `p:<uuid>` (perfil com chave). */
  llmSelectValue: string;
  setLlmSelectValue: (v: string) => void;
  llmProfiles: LlmProfileDTO[];
  /** OpenAI ou Google para POST /audio/transcribe (não aceita `auto`). */
  transcribeModelProvider: "openai" | "google";
  loadingList: boolean;
  loadingMessages: boolean;
  sending: boolean;
  error: string | null;
  /** Aviso curto após envio automático de e-mail pelo chat (quando a opção está activa). */
  emailSendNotice: string | null;
  clearEmailSendNotice: () => void;
  /** Aviso após o agente aplicar operações nas listas de tarefas. */
  taskListNotice: string | null;
  clearTaskListNotice: () => void;
  /** Aviso após o agente actualizar o preview no estúdio. */
  devStudioNotice: string | null;
  clearDevStudioNotice: () => void;
  selectConversation: (
    id: string | null,
    defaultModel?: ModelProvider | string,
  ) => Promise<void>;
  refreshConversations: () => Promise<void>;
  /** Recarrega perfis LLM (ex.: após criar/eliminar em Definições). */
  refreshLlmProfiles: () => Promise<void>;
  createNewConversation: () => Promise<string | null>;
  clearWorkspace: () => void;
  sendAuthenticatedMessage: (text: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
};

const ConversationWorkspaceContext =
  createContext<ConversationWorkspaceValue | null>(null);

export function ConversationWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { token, logout } = useAuth();
  const { openPlugin } = useAppLaunch();
  const {
    setDashboardData,
    openTaskListsPreview,
    closeTaskListsPreview,
    devStudioWorkspacePath,
    devStudioProjectTitle,
    setDevStudioProject,
    setDevStudioPreviewOpen,
  } = useWorkspace();

  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [llmSelectValue, setLlmSelectValue] = useState<string>("auto");
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileDTO[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSendNotice, setEmailSendNotice] = useState<string | null>(null);
  const [taskListNotice, setTaskListNotice] = useState<string | null>(null);
  const [devStudioNotice, setDevStudioNotice] = useState<string | null>(null);

  const clearEmailSendNotice = useCallback(() => {
    setEmailSendNotice(null);
  }, []);

  const clearTaskListNotice = useCallback(() => {
    setTaskListNotice(null);
  }, []);

  const clearDevStudioNotice = useCallback(() => {
    setDevStudioNotice(null);
  }, []);

  const onSessionUnauthorized = useCallback(() => {
    logout();
    setError(null);
    setEmailSendNotice(null);
    setTaskListNotice(null);
    setDevStudioNotice(null);
  }, [logout]);

  const refreshConversations = useCallback(async () => {
    if (!token) {
      setConversations([]);
      return;
    }
    setLoadingList(true);
    setError(null);
    try {
      const list = await fetchConversations(token);
      setConversations(list);
    } catch (e) {
      if (e instanceof SessionReloginRedirected) {
        setConversations([]);
        return;
      }
      if (isApiUnauthorized(e)) {
        onSessionUnauthorized();
        setConversations([]);
        return;
      }
      setError(e instanceof Error ? e.message : "Falha ao carregar conversas");
      setConversations([]);
    } finally {
      setLoadingList(false);
    }
  }, [token, onSessionUnauthorized]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const refreshLlmProfiles = useCallback(async () => {
    if (!token) {
      setLlmProfiles([]);
      return;
    }
    try {
      const list = await fetchLlmProfiles(token);
      setLlmProfiles(list);
    } catch {
      setLlmProfiles([]);
    }
  }, [token]);

  useEffect(() => {
    void refreshLlmProfiles();
  }, [refreshLlmProfiles]);

  useEffect(() => {
    const { profileId } = parseLlmRoutingSelect(llmSelectValue);
    if (!profileId || llmProfiles.length === 0) return;
    const ok = llmProfiles.some((p) => p.id === profileId && p.has_api_key);
    if (!ok) setLlmSelectValue("auto");
  }, [llmProfiles, llmSelectValue]);

  const selectConversation = useCallback(
    async (id: string | null, defaultModel?: ModelProvider | string) => {
      setActiveConversationId(id);
      setMessages([]);
      if (defaultModel) {
        setLlmSelectValue(defaultModel);
      }
      if (!token || !id) return;
      setLoadingMessages(true);
      setError(null);
      try {
        const msgs = await fetchMessages(token, id);
        setMessages(msgs);
        if (!defaultModel) {
          const conv = conversations.find((c) => c.id === id);
          if (conv?.default_model_provider) {
            setLlmSelectValue(conv.default_model_provider);
          }
        }
        // Restaurar projecto Dev Studio se a conversa já gerou ficheiros (project_id presente).
        const restored = restoreDevStudioProjectFromMessages(msgs);
        if (restored) {
          setDevStudioProject(restored.workspacePath, restored.title);
          setDevStudioPreviewOpen(true);
        }
      } catch (e) {
        if (e instanceof SessionReloginRedirected) {
          return;
        }
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        setError(e instanceof Error ? e.message : "Falha ao carregar mensagens");
      } finally {
        setLoadingMessages(false);
      }
    },
    [
      token,
      conversations,
      onSessionUnauthorized,
      setDevStudioProject,
      setDevStudioPreviewOpen,
    ],
  );

  const createNewConversation = useCallback(async (): Promise<string | null> => {
    if (!token) return null;
    setError(null);
    try {
      const dm = defaultModelForNewConversation(llmSelectValue);
      const c = await apiCreateConversation(token, {
        default_model_provider: dm,
      });
      await refreshConversations();
      setActiveConversationId(c.id);
      setMessages([]);
      setLlmSelectValue(c.default_model_provider ?? dm);
      return c.id;
    } catch (e) {
      if (e instanceof SessionReloginRedirected) {
        return null;
      }
      if (isApiUnauthorized(e)) {
        onSessionUnauthorized();
        return null;
      }
      setError(
        e instanceof Error ? e.message : "Não foi possível criar conversa",
      );
      return null;
    }
  }, [token, llmSelectValue, refreshConversations, onSessionUnauthorized]);

  const sendAuthenticatedMessage = useCallback(
    async (text: string) => {
      if (!token) return;
      setSending(true);
      setError(null);
      setEmailSendNotice(null);
      setTaskListNotice(null);
      setDevStudioNotice(null);
      try {
        let cid = activeConversationId;
        if (!cid) {
          cid = await createNewConversation();
          if (!cid) return;
        }
        const cidFinal = cid;
        let finalMessages: MessageDTO[] | null = null;

        const { model, profileId } = parseLlmRoutingSelect(llmSelectValue);
        const devPayload = await collectDevStudioChatPayload({
          workspacePath: devStudioWorkspacePath,
          messages,
        });
        const streamBody: import("@/lib/conversationsApi").ChatMessageBody = {
          text,
          model_provider: model,
          ...devPayload,
        };
        if (profileId) streamBody.llm_profile_id = profileId;

        await apiStreamMessage(
          token,
          cidFinal,
          streamBody,
          (event: StreamEvent) => {
            if (event.type === "progress") {
              if (event.label?.trim()) {
                setDevStudioNotice(event.label.trim());
              }
            } else if (event.type === "file") {
              /* reservado */
            } else if (event.type === "messages_saved") {
              finalMessages = event.messages;
              setMessages(event.messages);
              tryOpenNativePluginFromMessages(event.messages, openPlugin);
              const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
              const db = parseDashboardMeta(lastAssistant?.metadata);
              if (db) setDashboardData(db);
              if (messageIndicatesTaskListInteraction(lastAssistant?.metadata)) {
                openTaskListsPreview();
              }
              if (messageIndicatesDevStudioInteraction(lastAssistant?.metadata)) {
                setDevStudioPreviewOpen(true);
              }
            } else if (event.type === "error") {
              const d = event.detail ?? "";
              if (errorMessageIndicatesPolvointelUnauthorized(d)) {
                forceReloginRedirect();
                return;
              }
              setError(d || "Erro no agente");
            }
          },
        );

        // Se não recebemos messages_saved (erro ou stream vazio), recarrega mensagens.
        if (!finalMessages) {
          const msgs = await fetchMessages(token, cidFinal);
          setMessages(msgs);
        }

        // Auto-envio de e-mail se aplicável.
        const msgs = finalMessages ?? (await fetchMessages(token, cidFinal).catch(() => [] as MessageDTO[]));
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
        const em = parseEmailMessageMeta(lastAssistant?.metadata);
        if (em?.email_send_pending && em.email_send_draft) {
          try {
            const smtp = await mail.getSmtpSettings(token);
            if (smtp.email_chat_skip_confirmation) {
              const draftBody = em.email_send_draft.body ?? "";
              if (!emailBodyLooksReadyForAutosend(draftBody)) {
                setEmailSendNotice(
                  "Envio automático não efectuado: o corpo do e-mail ainda parece incompleto. Confirma o texto ou pede uma versão final.",
                );
              } else {
                await mail.sendEmail(token, buildEmailSendPayload(em.email_send_draft));
                setEmailSendNotice("E-mail enviado automaticamente.");
                const refreshed = await fetchMessages(token, cidFinal);
                setMessages(refreshed);
              }
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "Falha no envio automático do e-mail");
          }
        }

        const tm = parseTaskListMessageMeta(lastAssistant?.metadata);
        if (
          tm?.task_list_ops_pending &&
          tm.task_list_ops &&
          tm.task_list_ops.length > 0 &&
          !tm.task_list_ops_blocked
        ) {
          try {
            const batchRes = await applyTaskListBatch(token, tm.task_list_ops);
            const failed = batchRes.steps.filter((s) => !s.ok);
            if (failed.length > 0) {
              const msg = failed.map((s) => `${s.op}: ${s.error ?? "erro"}`).join("; ");
              setError(`Operações nas listas de tarefas: ${msg}`);
            } else {
              setTaskListNotice("Listas de tarefas actualizadas pelo agente.");
              openTaskListsPreview();
            }
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Falha ao aplicar operações nas listas de tarefas",
            );
          }
        }

        if (shouldApplyDevStudioFromMetadata(lastAssistant?.metadata)) {
          try {
            setDashboardData(null);
            setDevStudioPreviewOpen(true);
            const pr = await applyDevStudioOpsFromMeta(lastAssistant?.metadata, {
              workspacePath: devStudioWorkspacePath,
              projectTitle: devStudioProjectTitle,
              setDevStudioProject,
              openPlugin,
              userPrompt: text,
            });
            if (!pr.applied && pr.error) {
              setError(pr.error);
            } else if (pr.applied) {
              const line = [pr.notice, pr.error].filter(Boolean).join(" ");
              if (line) setDevStudioNotice(line);
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : "Falha ao actualizar o preview");
          }
        } else if (messageIndicatesDevStudioInteraction(lastAssistant?.metadata)) {
          const failMsg = devStudioApplyFailureMessage(lastAssistant?.metadata);
          if (failMsg) setDevStudioNotice(failMsg);
        }

        await refreshConversations();
      } catch (e) {
        if (e instanceof SessionReloginRedirected) {
          return;
        }
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        setError(e instanceof Error ? e.message : "Falha ao enviar");
      } finally {
        setSending(false);
      }
    },
    [
      token,
      activeConversationId,
      llmSelectValue,
      refreshConversations,
      createNewConversation,
      openPlugin,
      onSessionUnauthorized,
      setDashboardData,
      openTaskListsPreview,
      devStudioWorkspacePath,
      devStudioProjectTitle,
      setDevStudioProject,
      setDevStudioPreviewOpen,
      messages,
    ],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await apiDeleteConversation(token, id);
      } catch (e) {
        if (e instanceof SessionReloginRedirected) {
          return;
        }
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        throw e;
      }
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      await refreshConversations();
    },
    [token, activeConversationId, refreshConversations, onSessionUnauthorized],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      if (!token) return;
      try {
        await apiRenameConversation(token, id, title);
      } catch (e) {
        if (e instanceof SessionReloginRedirected) {
          return;
        }
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        throw e;
      }
      await refreshConversations();
    },
    [token, refreshConversations, onSessionUnauthorized],
  );

  const pinConversation = useCallback(
    async (id: string, pinned: boolean) => {
      if (!token) return;
      let updated: ConversationDTO;
      try {
        updated = await apiPinConversation(token, id, pinned);
      } catch (e) {
        if (e instanceof SessionReloginRedirected) {
          return;
        }
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        throw e;
      }
      setConversations((prev) => {
        const others = prev.filter((c) => c.id !== id);
        return [...others, updated];
      });
      await refreshConversations();
    },
    [token, refreshConversations, onSessionUnauthorized],
  );

  const transcribeProv = useMemo(
    () => transcribeModelProvider(llmSelectValue, llmProfiles),
    [llmSelectValue, llmProfiles],
  );

  const clearWorkspace = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setLlmSelectValue("auto");
    setError(null);
    setEmailSendNotice(null);
    setTaskListNotice(null);
    setDevStudioNotice(null);
    closeTaskListsPreview();
    setDevStudioPreviewOpen(false);
    setDevStudioProject(null, null);
  }, [closeTaskListsPreview, setDevStudioPreviewOpen, setDevStudioProject]);

  const value = useMemo(
    () => ({
      conversations,
      activeConversationId,
      messages,
      llmSelectValue,
      setLlmSelectValue,
      llmProfiles,
      transcribeModelProvider: transcribeProv,
      loadingList,
      loadingMessages,
      sending,
      error,
      emailSendNotice,
      clearEmailSendNotice,
      taskListNotice,
      clearTaskListNotice,
      devStudioNotice,
      clearDevStudioNotice,
      selectConversation,
      refreshConversations,
      refreshLlmProfiles,
      createNewConversation,
      clearWorkspace,
      sendAuthenticatedMessage,
      deleteConversation,
      renameConversation,
      pinConversation,
    }),
    [
      conversations,
      activeConversationId,
      messages,
      llmSelectValue,
      llmProfiles,
      transcribeProv,
      loadingList,
      loadingMessages,
      sending,
      error,
      emailSendNotice,
      clearEmailSendNotice,
      taskListNotice,
      clearTaskListNotice,
      devStudioNotice,
      clearDevStudioNotice,
      selectConversation,
      refreshConversations,
      refreshLlmProfiles,
      createNewConversation,
      clearWorkspace,
      sendAuthenticatedMessage,
      deleteConversation,
      renameConversation,
      pinConversation,
    ],
  );

  return (
    <ConversationWorkspaceContext.Provider value={value}>
      {children}
    </ConversationWorkspaceContext.Provider>
  );
}

export function useConversationWorkspace(): ConversationWorkspaceValue {
  const ctx = useContext(ConversationWorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useConversationWorkspace deve estar dentro de ConversationWorkspaceProvider",
    );
  }
  return ctx;
}

/** Variante segura para chrome global (evita crash durante HMR). */
export function useConversationWorkspaceOptional(): ConversationWorkspaceValue | null {
  return useContext(ConversationWorkspaceContext);
}
