import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DeskModelProvider } from "@/lib/deskContext";
import type { DeskMode } from "./types";

type DeskModeContextValue = {
  mode: DeskMode;
  setMode: (mode: DeskMode) => void;
  modelProvider: DeskModelProvider;
  setModelProvider: (provider: DeskModelProvider) => void;
};

const DeskModeContext = createContext<DeskModeContextValue | null>(null);

export function DeskModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DeskMode>("agent");
  const [modelProvider, setModelProviderState] = useState<DeskModelProvider>("ollama");

  const setMode = useCallback((next: DeskMode) => {
    setModeState(next);
  }, []);

  const setModelProvider = useCallback((next: DeskModelProvider) => {
    setModelProviderState(next);
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, modelProvider, setModelProvider }),
    [mode, setMode, modelProvider, setModelProvider],
  );

  return (
    <DeskModeContext.Provider value={value}>{children}</DeskModeContext.Provider>
  );
}

export function useDeskMode(): DeskModeContextValue {
  const ctx = useContext(DeskModeContext);
  if (!ctx) {
    throw new Error("useDeskMode deve estar dentro de DeskModeProvider");
  }
  return ctx;
}

export function useDeskModeOptional(): DeskModeContextValue | null {
  return useContext(DeskModeContext);
}
