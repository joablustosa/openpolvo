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
import type { AppId } from "@/config/apps";
import type { DashboardData } from "@/lib/dashboardMetadata";

const SIDEBAR_KEY = "smartagent_sidebar_collapsed";

type WorkspaceContextValue = {
  activeApp: AppId | null;
  setActiveApp: (id: AppId | null) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  /** Dashboard gerado pelo agente; null quando nenhum está activo. */
  dashboardData: DashboardData | null;
  setDashboardData: (data: DashboardData | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [activeApp, setActiveAppState] = useState<AppId | null>(null);
  const [dashboardData, setDashboardDataState] = useState<DashboardData | null>(null);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  });
  const prevTokenRef = useRef<string | null>(token);

  useEffect(() => {
    const prev = prevTokenRef.current;
    prevTokenRef.current = token;
    if (prev && !token) {
      setActiveAppState(null);
      setDashboardDataState(null);
    }
  }, [token]);

  const setActiveApp = useCallback((id: AppId | null) => {
    setActiveAppState(id);
  }, []);

  const setDashboardData = useCallback((data: DashboardData | null) => {
    setDashboardDataState(data);
  }, []);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      activeApp,
      setActiveApp,
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      dashboardData,
      setDashboardData,
    }),
    [activeApp, setActiveApp, sidebarCollapsed, toggleSidebar, setSidebarCollapsed, dashboardData, setDashboardData],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace deve estar dentro de WorkspaceProvider");
  return ctx;
}
