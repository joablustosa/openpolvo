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
  /** Preview de listas de tarefas ao lado do chat (respostas sobre to-do). */
  taskListsPreviewOpen: boolean;
  taskListsPreviewNonce: number;
  openTaskListsPreview: () => void;
  refreshTaskListsPreview: () => void;
  closeTaskListsPreview: () => void;
  /** Fecha dashboard, plugin, preview de listas — volta ao layout da página inicial. */
  resetShellLayout: () => void;
  /** Caminho do projecto Polvo Code no disco (Electron). */
  polvoCodeWorkspacePath: string | null;
  polvoCodeProjectTitle: string | null;
  setPolvoCodeProject: (workspacePath: string | null, title?: string | null) => void;
  clearPolvoCode: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [activeApp, setActiveAppState] = useState<AppId | null>(null);
  const [dashboardData, setDashboardDataState] = useState<DashboardData | null>(null);
  const [taskListsPreviewOpen, setTaskListsPreviewOpen] = useState(false);
  const [taskListsPreviewNonce, setTaskListsPreviewNonce] = useState(0);
  const [polvoCodeWorkspacePath, setPolvoCodeWorkspacePathState] = useState<string | null>(null);
  const [polvoCodeProjectTitle, setPolvoCodeProjectTitleState] = useState<string | null>(null);
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
      setTaskListsPreviewOpen(false);
      setTaskListsPreviewNonce(0);
      setPolvoCodeWorkspacePathState(null);
      setPolvoCodeProjectTitleState(null);
    }
  }, [token]);

  const setActiveApp = useCallback((id: AppId | null) => {
    setActiveAppState(id);
  }, []);

  const setDashboardData = useCallback((data: DashboardData | null) => {
    setDashboardDataState(data);
  }, []);

  const openTaskListsPreview = useCallback(() => {
    setTaskListsPreviewOpen(true);
    setTaskListsPreviewNonce((n) => n + 1);
  }, []);

  const refreshTaskListsPreview = useCallback(() => {
    setTaskListsPreviewNonce((n) => n + 1);
  }, []);

  const closeTaskListsPreview = useCallback(() => {
    setTaskListsPreviewOpen(false);
  }, []);

  const resetShellLayout = useCallback(() => {
    setActiveAppState(null);
    setDashboardDataState(null);
    setTaskListsPreviewOpen(false);
    setTaskListsPreviewNonce(0);
    setPolvoCodeWorkspacePathState(null);
    setPolvoCodeProjectTitleState(null);
  }, []);

  const setPolvoCodeProject = useCallback((workspacePath: string | null, title?: string | null) => {
    setPolvoCodeWorkspacePathState(workspacePath);
    setPolvoCodeProjectTitleState(title ?? null);
  }, []);

  const clearPolvoCode = useCallback(() => {
    setPolvoCodeWorkspacePathState(null);
    setPolvoCodeProjectTitleState(null);
  }, []);

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
    localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      }
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
      taskListsPreviewOpen,
      taskListsPreviewNonce,
      openTaskListsPreview,
      refreshTaskListsPreview,
      closeTaskListsPreview,
      resetShellLayout,
      polvoCodeWorkspacePath,
      polvoCodeProjectTitle,
      setPolvoCodeProject,
      clearPolvoCode,
    }),
    [
      activeApp,
      setActiveApp,
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      dashboardData,
      setDashboardData,
      taskListsPreviewOpen,
      taskListsPreviewNonce,
      openTaskListsPreview,
      refreshTaskListsPreview,
      closeTaskListsPreview,
      resetShellLayout,
      polvoCodeWorkspacePath,
      polvoCodeProjectTitle,
      setPolvoCodeProject,
      clearPolvoCode,
    ],
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
