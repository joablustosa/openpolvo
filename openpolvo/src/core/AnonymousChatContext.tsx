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

const STORAGE_KEY = "laele_anonymous_user_turns";
const MAX_ANONYMOUS_TURNS = 2;

function readCount(): number {
  if (typeof sessionStorage === "undefined") return 0;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeCount(n: number) {
  sessionStorage.setItem(STORAGE_KEY, String(n));
}

type AnonymousChatContextValue = {
  loginModalOpen: boolean;
  setLoginModalOpen: (open: boolean) => void;
  openLoginModal: () => void;
  /** Chamado antes de enviar; devolve false se deve bloquear (já usou as 2 perguntas). */
  canSendAsAnonymous: () => boolean;
  /** Chamado após um envio bem-sucedido como visitante (sem token). */
  afterAnonymousUserMessage: () => void;
  anonymousTurnsUsed: number;
};

const AnonymousChatContext = createContext<AnonymousChatContextValue | null>(
  null,
);

export function AnonymousChatProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [anonymousTurnsUsed, setAnonymousTurnsUsed] = useState(readCount);

  useEffect(() => {
    if (token) {
      sessionStorage.removeItem(STORAGE_KEY);
      setAnonymousTurnsUsed(0);
      setLoginModalOpen(false);
    }
  }, [token]);

  const openLoginModal = useCallback(() => setLoginModalOpen(true), []);

  const canSendAsAnonymous = useCallback(() => {
    if (token) return true;
    const count = readCount();
    if (count >= MAX_ANONYMOUS_TURNS) {
      setLoginModalOpen(true);
      return false;
    }
    return true;
  }, [token]);

  const afterAnonymousUserMessage = useCallback(() => {
    if (token) return;
    const next = readCount() + 1;
    writeCount(next);
    setAnonymousTurnsUsed(next);
    if (next >= MAX_ANONYMOUS_TURNS) {
      setLoginModalOpen(true);
    }
  }, [token]);

  const value = useMemo(
    () => ({
      loginModalOpen,
      setLoginModalOpen,
      openLoginModal,
      canSendAsAnonymous,
      afterAnonymousUserMessage,
      anonymousTurnsUsed,
    }),
    [
      loginModalOpen,
      openLoginModal,
      canSendAsAnonymous,
      afterAnonymousUserMessage,
      anonymousTurnsUsed,
    ],
  );

  return (
    <AnonymousChatContext.Provider value={value}>
      {children}
    </AnonymousChatContext.Provider>
  );
}

export function useAnonymousChat(): AnonymousChatContextValue {
  const ctx = useContext(AnonymousChatContext);
  if (!ctx) {
    throw new Error("useAnonymousChat deve estar dentro de AnonymousChatProvider");
  }
  return ctx;
}
