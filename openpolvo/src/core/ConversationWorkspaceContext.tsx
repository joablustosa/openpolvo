import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  patchAssistantDevStudioProjectId,
  resolveDevStudioProjectForConversation,
  shouldApplyDevStudioFromMetadata,
} from "@/lib/devStudioMetadata";
import { applyDevStudioFileIncremental } from "@/lib/devStudio/incrementalDevStudioApply";
import {
  removeDevStudioConversationProject,
  saveDevStudioConversationProject,
} from "@/lib/devStudio/conversationProjectLink";
import {
  fetchConversationProject,
  fetchProjectWithFiles,
  projectFilesToRecord,
} from "@/lib/devStudio/projectApi";
import { collectDevStudioChatPayload } from "@/lib/devStudioChatPayload";
import { tryOpenNativePluginFromMessages } from "@/lib/nativePluginMetadata";
import { useAppLaunch } from "@/hooks/useAppLaunch";
import { useDeskModeOptional } from "@/desk/DeskModeContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { isDeskMvpMode } from "@/lib/deskMvpMode";
import { buildDeskContextPayload } from "@/lib/deskContext";
import { executeDeskToolCall } from "@/lib/deskToolExecutor";
import { type AgentEventRecord, parseAgentEventKind } from "@/lib/agentEventTypes";
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
  /** Logs SSE do agente (Desk MVP). */
  agentLogEvents: AgentEventRecord[];
  clearAgentLog: () => void;
  agentLogAutoScroll: boolean;
  setAgentLogAutoScroll: (v: boolean) => void;
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
  const deskMode = useDeskModeOptional();
  const {
    setDashboardData,
    openTaskListsPreview,
    closeTaskListsPreview,
    devStudioWorkspacePath,
    devStudioProjectTitle,
    setDevStudioProject,
    setDevStudioPreviewOpen,
    restartDevStudioPreview,
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
  const [agentLogEvents, setAgentLogEvents] = useState<AgentEventRecord[]>([]);
  const [agentLogAutoScroll, setAgentLogAutoScroll] = useState(true);
  const agentLogSeqRef = useRef(0);

  const clearAgentLog = useCallback(() => {
    setAgentLogEvents([]);
  }, []);

  const appendAgentLogEvent = useCallback((eventType: string, payload: Record<string, unknown>) => {
    agentLogSeqRef.current += 1;
    const record: AgentEventRecord = {
      id: `ae-${agentLogSeqRef.current}`,
      kind: parseAgentEventKind(eventType),
      payload,
      at: Date.now(),
    };
    setAgentLogEvents((prev) => [...prev, record]);
  }, []);

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

  /**
   * Restaura o preview WebContainer de uma conversa (browser):
   * isola o estado por conversa e hidrata os ficheiros a partir do backend
   * (preferido), com fallback ao estado em sessão / metadata.
   */
  const restoreWebContainerProjectForConversation = useCallback(
    async (id: string, msgs: MessageDTO[]) => {
      if (!token) return;
      const { getWebContainerPreviewService, WEBCONTAINER_WORKSPACE_ID } =
        await import("@/lib/webcontainer");
      const svc = getWebContainerPreviewService();
      await svc.switchConversation(id);

      let backendTitle: string | null = null;
      try {
        const proj = await fetchConversationProject(token, id);
        if (proj) {
          backendTitle = proj.title;
          const withFiles = await fetchProjectWithFiles(token, proj.id);
          if (withFiles && withFiles.files.length) {
            svc.setVirtualFiles(projectFilesToRecord(withFiles.files));
          }
        }
      } catch {
        // Sem backend — usa o estado em sessão / metadata como fallback.
      }

      const restored = resolveDevStudioProjectForConversation(id, msgs);
      if (svc.hasVirtualFiles()) {
        const title = backendTitle ?? restored?.title ?? devStudioProjectTitle;
        setDevStudioProject(WEBCONTAINER_WORKSPACE_ID, title);
        setDevStudioPreviewOpen(true);
        restartDevStudioPreview();
      } else {
        setDevStudioProject(null, null);
        setDevStudioPreviewOpen(false);
      }
    },
    [
      token,
      devStudioProjectTitle,
      setDevStudioProject,
      setDevStudioPreviewOpen,
      restartDevStudioPreview,
    ],
  );

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
        // Liga conversa ↔ projecto (disco no Electron; WebContainer no browser).
        // Estado de verificação contínua é por conversa — limpa ao trocar.
        const { isElectron, desktopPolvoCode } = await import("@/lib/desktopApi");
        const { resetPreviewAutoHealSession } = await import(
          "@/lib/devStudio/previewAutoHeal"
        );
        const { clearDevStudioCompileLog } = await import(
          "@/lib/devStudio/compileLogBuffer"
        );
        resetPreviewAutoHealSession();
        clearDevStudioCompileLog();
        const inElectron = isElectron();

        if (inElectron) {
          const restored = resolveDevStudioProjectForConversation(id, msgs);
          const { clearLastDevStudioUrl } = await import(
            "@/lib/devStudioPreviewBus"
          );
          const prevPath = devStudioWorkspacePath?.trim() ?? "";
          if (restored) {
            let canOpen = true;
            try {
              const lr = await desktopPolvoCode.listDir({
                workspacePath: restored.workspacePath,
                relPath: "",
              });
              if (!lr.ok) {
                canOpen = false;
                setDevStudioNotice(
                  "Projecto não encontrado no disco (pode ter sido movido). Use «Escolher pasta» no Estúdio.",
                );
              }
            } catch {
              // Se a verificação falhar, tenta abrir na mesma.
            }
            if (canOpen) {
              const nextPath = restored.workspacePath.trim();
              const pathChanged = !prevPath || prevPath !== nextPath;
              clearLastDevStudioUrl();
              if (pathChanged && prevPath) {
                await desktopPolvoCode.devStop();
              }
              try {
                const { repairDevStudioProjectOnDisk } = await import(
                  "@/lib/devStudio/repairDevStudioProject",
                );
                await repairDevStudioProjectOnDisk(nextPath);
              } catch {
                /* reparo best-effort */
              }
              setDevStudioProject(restored.workspacePath, restored.title);
              setDevStudioPreviewOpen(true);
              if (!pathChanged) {
                restartDevStudioPreview();
              }
            }
          } else if (prevPath) {
            try {
              await desktopPolvoCode.devStop();
            } catch {
              /* ignore */
            }
            setDevStudioProject(null, null);
            setDevStudioPreviewOpen(false);
          }
        } else {
          await restoreWebContainerProjectForConversation(id, msgs);
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
      devStudioWorkspacePath,
      setDevStudioProject,
      setDevStudioPreviewOpen,
      restartDevStudioPreview,
      restoreWebContainerProjectForConversation,
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
      try {
        const { resetPreviewAutoHealSession } = await import(
          "@/lib/devStudio/previewAutoHeal"
        );
        const { clearDevStudioCompileLog } = await import(
          "@/lib/devStudio/compileLogBuffer"
        );
        resetPreviewAutoHealSession();
        clearDevStudioCompileLog();
        const { isElectron, desktopPolvoCode } = await import("@/lib/desktopApi");
        if (isElectron()) {
          await desktopPolvoCode.devStop();
        } else {
          const { getWebContainerPreviewService } = await import(
            "@/lib/webcontainer"
          );
          await getWebContainerPreviewService().switchConversation(c.id);
        }
      } catch {
        /* ignore */
      }
      setDevStudioProject(null, null);
      setDevStudioPreviewOpen(false);
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
  }, [
    token,
    llmSelectValue,
    refreshConversations,
    onSessionUnauthorized,
    setDevStudioProject,
    setDevStudioPreviewOpen,
  ]);

  const sendAuthenticatedMessage = useCallback(
    async (text: string) => {
      if (!token) return;
      setSending(true);
      setError(null);
      setEmailSendNotice(null);
      setTaskListNotice(null);
      setDevStudioNotice(null);
      if (isDeskMvpMode()) {
        clearAgentLog();
      }
      try {
        let cid = activeConversationId;
        if (!cid) {
          cid = await createNewConversation();
          if (!cid) return;
        }
        const cidFinal = cid;
        let finalMessages: MessageDTO[] | null = null;

        const { model, profileId } = parseLlmRoutingSelect(llmSelectValue);
        const devPayload =
          isDeskMvpMode()
            ? {}
            : await collectDevStudioChatPayload({
                workspacePath: devStudioWorkspacePath,
                messages,
              });
        const streamBody: import("@/lib/conversationsApi").ChatMessageBody = {
          text,
          model_provider: model,
          ...devPayload,
        };
        if (profileId) streamBody.llm_profile_id = profileId;

        if (isDeskMvpMode() && deskMode) {
          streamBody.desk_context = buildDeskContextPayload({
            deskMode: deskMode.mode,
            workspacePath: devStudioWorkspacePath,
            conversationId: cidFinal,
            modelProvider: deskMode.modelProvider,
          });
        }

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
              void applyDevStudioFileIncremental(event.file, {
                workspacePath: devStudioWorkspacePath,
              }).then((ok) => {
                if (ok && event.file.path?.trim()) {
                  setDevStudioNotice(`A escrever ${event.file.path}…`);
                  setDevStudioPreviewOpen(true);
                }
              });
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
            } else if (event.type === "agent_event") {
              const payload = event.payload ?? {};
              appendAgentLogEvent(event.event_type, payload);
              if (
                event.event_type === "tool_call" &&
                payload.requires_client === true &&
                isDeskMvpMode() &&
                devStudioWorkspacePath?.trim()
              ) {
                void executeDeskToolCall({
                  token,
                  conversationId: cidFinal,
                  workspacePath: devStudioWorkspacePath.trim(),
                  payload,
                }).catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  setError(msg || "Erro ao executar tool Desk");
                });
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
              conversationId: cidFinal,
            });
            if (!pr.applied && pr.error) {
              setError(pr.error);
            } else if (pr.applied) {
              if (pr.workspacePath?.trim()) {
                saveDevStudioConversationProject(
                  cidFinal,
                  pr.workspacePath,
                  pr.title ?? devStudioProjectTitle,
                );
                const baseMsgs =
                  finalMessages ??
                  (await fetchMessages(token, cidFinal).catch(() => [] as MessageDTO[]));
                setMessages(
                  patchAssistantDevStudioProjectId(
                    baseMsgs,
                    pr.workspacePath,
                    pr.title ?? devStudioProjectTitle,
                  ),
                );
              }
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
      restartDevStudioPreview,
      messages,
      deskMode,
      clearAgentLog,
      appendAgentLogEvent,
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
      removeDevStudioConversationProject(id);
      try {
        const { isElectron } = await import("@/lib/desktopApi");
        if (!isElectron()) {
          const { getWebContainerPreviewService } = await import(
            "@/lib/webcontainer"
          );
          getWebContainerPreviewService().forgetConversation(id);
        }
      } catch {
        /* ignore */
      }
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
        try {
          const { isElectron, desktopPolvoCode } = await import("@/lib/desktopApi");
          if (isElectron()) await desktopPolvoCode.devStop();
        } catch {
          /* ignore */
        }
        setDevStudioProject(null, null);
        setDevStudioPreviewOpen(false);
      }
      await refreshConversations();
    },
    [
      token,
      activeConversationId,
      refreshConversations,
      onSessionUnauthorized,
      setDevStudioProject,
      setDevStudioPreviewOpen,
      restartDevStudioPreview,
    ],
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
      agentLogEvents,
      clearAgentLog,
      agentLogAutoScroll,
      setAgentLogAutoScroll,
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
      agentLogEvents,
      clearAgentLog,
      agentLogAutoScroll,
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
