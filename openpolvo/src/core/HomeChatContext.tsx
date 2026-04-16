import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

type HomeChatContextValue = {
  registerReset: (fn: () => void) => void;
  requestNewChat: () => void;
};

const HomeChatContext = createContext<HomeChatContextValue | null>(null);

export function HomeChatProvider({ children }: { children: ReactNode }) {
  const resetRef = useRef<(() => void) | null>(null);

  const registerReset = useCallback((fn: () => void) => {
    resetRef.current = fn;
  }, []);

  const requestNewChat = useCallback(() => {
    resetRef.current?.();
  }, []);

  return (
    <HomeChatContext.Provider value={{ registerReset, requestNewChat }}>
      {children}
    </HomeChatContext.Provider>
  );
}

export function useHomeChatControls(): HomeChatContextValue {
  const ctx = useContext(HomeChatContext);
  if (!ctx) {
    throw new Error("useHomeChatControls deve estar dentro de HomeChatProvider");
  }
  return ctx;
}
