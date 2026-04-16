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
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  fetchConversations,
  fetchMessages,
  pinConversation as apiPinConversation,
  postMessage as apiPostMessage,
  renameConversation as apiRenameConversation,
} from "@/lib/conversationsApi";
import { isApiUnauthorized } from "@/lib/apiErrors";
import { tryOpenNativePluginFromMessages } from "@/lib/nativePluginMetadata";
import { useAppLaunch } from "@/hooks/useAppLaunch";

type ConversationWorkspaceValue = {
  conversations: ConversationDTO[];
  activeConversationId: string | null;
  messages: MessageDTO[];
  modelProvider: ModelProvider;
  setModelProvider: (m: ModelProvider) => void;
  loadingList: boolean;
  loadingMessages: boolean;
  sending: boolean;
  error: string | null;
  selectConversation: (
    id: string | null,
    defaultModel?: ModelProvider,
  ) => Promise<void>;
  refreshConversations: () => Promise<void>;
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
  const { openLoginModal } = useAnonymousChat();
  const { openPlugin } = useAppLaunch();

  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [modelProvider, setModelProviderState] =
    useState<ModelProvider>("openai");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSessionUnauthorized = useCallback(() => {
    logout();
    openLoginModal();
    setError(null);
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

  const selectConversation = useCallback(
    async (id: string | null, defaultModel?: ModelProvider) => {
      setActiveConversationId(id);
      setMessages([]);
      if (defaultModel) {
        setModelProviderState(defaultModel);
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
            setModelProviderState(conv.default_model_provider);
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
      const c = await apiCreateConversation(token, {
        default_model_provider: modelProvider,
      });
      await refreshConversations();
      setActiveConversationId(c.id);
      setMessages([]);
      setModelProviderState(c.default_model_provider ?? modelProvider);
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
  }, [token, modelProvider, refreshConversations, onSessionUnauthorized]);

  const sendAuthenticatedMessage = useCallback(
    async (text: string) => {
      if (!token) return;
      setSending(true);
      setError(null);
      try {
        let cid = activeConversationId;
        if (!cid) {
          cid = await createNewConversation();
          if (!cid) return;
        }
        const msgs = await apiPostMessage(token, cid, {
          text,
          model_provider: modelProvider,
        });
        setMessages(msgs);
        tryOpenNativePluginFromMessages(msgs, openPlugin);
        await refreshConversations();
      } catch (e) {
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
      modelProvider,
      refreshConversations,
      createNewConversation,
      openPlugin,
      onSessionUnauthorized,
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

  const setModelProvider = useCallback((m: ModelProvider) => {
    setModelProviderState(m);
  }, []);

  const clearWorkspace = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      conversations,
      activeConversationId,
      messages,
      modelProvider,
      setModelProvider,
      loadingList,
      loadingMessages,
      sending,
      error,
      selectConversation,
      refreshConversations,
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
      modelProvider,
      setModelProvider,
      loadingList,
      loadingMessages,
      sending,
      error,
      selectConversation,
      refreshConversations,
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
