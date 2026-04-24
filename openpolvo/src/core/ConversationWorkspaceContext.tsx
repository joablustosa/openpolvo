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
import { useAnonymousChat } from "@/core/AnonymousChatContext";
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
import { isApiUnauthorized } from "@/lib/apiErrors";
import { buildEmailSendPayload, parseEmailMessageMeta } from "@/lib/emailChatMetadata";
import { messageIndicatesTaskListInteraction, parseTaskListMessageMeta } from "@/lib/taskListChatMetadata";
import { applyTaskListBatch } from "@/lib/taskListsApi";
import { parseSchedMessageMeta } from "@/lib/scheduleChatMetadata";
import {
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  type CreateScheduledTaskInput,
  type UpdateScheduledTaskInput,
} from "@/lib/scheduleApi";
import { tryOpenNativePluginFromMessages } from "@/lib/nativePluginMetadata";
import { parseDashboardMeta } from "@/lib/dashboardMetadata";
import {
  builderDataFromAssistantMetadata,
  findLatestBuilderDataInMessages,
} from "@/lib/builderMetadata";
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
  selectConversation: (
    id: string | null,
    defaultModel?: ModelProvider | string,
  ) => Promise<void>;
  refreshConversations: () => Promise<void>;
  createNewConversation: () => Promise<string | null>;
  clearWorkspace: () => void;
  sendAuthenticatedMessage: (text: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  /** Carrega mensagens, extrai o último projecto Builder e abre o painel de preview. */
  openBuilderPreviewForConversation: (conversationId: string) => Promise<boolean>;
};

const ConversationWorkspaceContext =
  createContext<ConversationWorkspaceValue | null>(null);

export function ConversationWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { token, logout } = useAuth();
  const { openLoginModal } = useAnonymousChat();
  const { openPlugin } = useAppLaunch();
  const {
    setDashboardData,
    setBuilderData,
    setBuilderProgress,
    setBuilderStreamFiles,
    openTaskListsPreview,
    closeTaskListsPreview,
    setActiveApp,
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

  const clearEmailSendNotice = useCallback(() => {
    setEmailSendNotice(null);
  }, []);

  const clearTaskListNotice = useCallback(() => {
    setTaskListNotice(null);
  }, []);

  const onSessionUnauthorized = useCallback(() => {
    logout();
    openLoginModal();
    setError(null);
    setEmailSendNotice(null);
    setTaskListNotice(null);
  }, [logout, openLoginModal]);

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
      } catch (e) {
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        setError(e instanceof Error ? e.message : "Falha ao carregar mensagens");
      } finally {
        setLoadingMessages(false);
      }
    },
    [token, conversations, onSessionUnauthorized],
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
      setBuilderProgress(null);
      setBuilderStreamFiles([]);
      try {
        let cid = activeConversationId;
        if (!cid) {
          cid = await createNewConversation();
          if (!cid) return;
        }
        const cidFinal = cid;
        let finalMessages: MessageDTO[] | null = null;

        const { model, profileId } = parseLlmRoutingSelect(llmSelectValue);
        const streamBody: {
          text: string;
          model_provider?: ModelProvider;
          llm_profile_id?: string;
        } = { text, model_provider: model };
        if (profileId) streamBody.llm_profile_id = profileId;

        await apiStreamMessage(
          token,
          cidFinal,
          streamBody,
          (event: StreamEvent) => {
            if (event.type === "progress") {
              setBuilderProgress({ step: event.step, label: event.label });
            } else if (event.type === "file") {
              setBuilderStreamFiles((prev) => [...prev, event.file]);
            } else if (event.type === "messages_saved") {
              finalMessages = event.messages;
              setMessages(event.messages);
              tryOpenNativePluginFromMessages(event.messages, openPlugin);
              const lastAssistant = [...event.messages].reverse().find((m) => m.role === "assistant");
              const db = parseDashboardMeta(lastAssistant?.metadata);
              if (db) setDashboardData(db);
              const bd = builderDataFromAssistantMetadata(lastAssistant?.metadata);
              if (bd) {
                setBuilderData(bd);
                setBuilderStreamFiles([]);
              }
              if (messageIndicatesTaskListInteraction(lastAssistant?.metadata)) {
                openTaskListsPreview();
              }
            } else if (event.type === "error") {
              setError(event.detail || "Erro no agente");
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
              await mail.sendEmail(token, buildEmailSendPayload(em.email_send_draft));
              setEmailSendNotice("E-mail enviado automaticamente.");
              const refreshed = await fetchMessages(token, cidFinal);
              setMessages(refreshed);
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

        const sm = parseSchedMessageMeta(lastAssistant?.metadata);
        if (
          sm?.scheduled_task_ops_pending &&
          sm.scheduled_task_ops &&
          sm.scheduled_task_ops.length > 0 &&
          !sm.scheduled_task_ops_blocked
        ) {
          const errors: string[] = [];
          for (const op of sm.scheduled_task_ops) {
            const opName = String(op.op ?? "");
            try {
              if (opName === "create") {
                await createScheduledTask(op as unknown as CreateScheduledTaskInput);
              } else if (opName === "update") {
                const { op: _, id, ...rest } = op as Record<string, unknown>;
                await updateScheduledTask(String(id), rest as UpdateScheduledTaskInput);
              } else if (opName === "delete") {
                await deleteScheduledTask(String(op.id));
              } else if (opName === "toggle") {
                await updateScheduledTask(String(op.id), { active: Boolean(op.active) });
              }
            } catch (e) {
              errors.push(`${opName}: ${e instanceof Error ? e.message : "erro"}`);
            }
          }
          if (errors.length > 0) {
            setError(`Automações agendadas: ${errors.join("; ")}`);
          }
        }

        await refreshConversations();
      } catch (e) {
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return;
        }
        setError(e instanceof Error ? e.message : "Falha ao enviar");
      } finally {
        setSending(false);
        setBuilderProgress(null);
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
      setBuilderData,
      setBuilderProgress,
      setBuilderStreamFiles,
      openTaskListsPreview,
    ],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await apiDeleteConversation(token, id);
      } catch (e) {
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

  const openBuilderPreviewForConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!token) return false;
      setError(null);
      try {
        const msgs = await fetchMessages(token, conversationId);
        const bd = findLatestBuilderDataInMessages(msgs);
        if (!bd) {
          setError(
            "Esta conversa não tem um projecto com ficheiros para abrir no painel.",
          );
          return false;
        }
        setActiveApp(null);
        setDashboardData(null);
        setBuilderData(bd);
        setBuilderStreamFiles([]);
        setBuilderProgress(null);
        closeTaskListsPreview();
        setActiveConversationId(conversationId);
        setMessages(msgs);
        const conv = conversations.find((c) => c.id === conversationId);
        if (conv?.default_model_provider) {
          setLlmSelectValue(conv.default_model_provider);
        }
        return true;
      } catch (e) {
        if (isApiUnauthorized(e)) {
          onSessionUnauthorized();
          return false;
        }
        setError(e instanceof Error ? e.message : "Falha ao carregar o projecto");
        return false;
      }
    },
    [
      token,
      conversations,
      setActiveApp,
      setDashboardData,
      setBuilderData,
      setBuilderProgress,
      setBuilderStreamFiles,
      closeTaskListsPreview,
      onSessionUnauthorized,
    ],
  );

  const pinConversation = useCallback(
    async (id: string, pinned: boolean) => {
      if (!token) return;
      let updated: ConversationDTO;
      try {
        updated = await apiPinConversation(token, id, pinned);
      } catch (e) {
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
    closeTaskListsPreview();
  }, [closeTaskListsPreview]);

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
      selectConversation,
      refreshConversations,
      createNewConversation,
      clearWorkspace,
      sendAuthenticatedMessage,
      deleteConversation,
      renameConversation,
      pinConversation,
      openBuilderPreviewForConversation,
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
      selectConversation,
      refreshConversations,
      createNewConversation,
      clearWorkspace,
      sendAuthenticatedMessage,
      deleteConversation,
      renameConversation,
      pinConversation,
      openBuilderPreviewForConversation,
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
