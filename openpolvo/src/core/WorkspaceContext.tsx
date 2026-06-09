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
  /** Preview do estúdio ao lado do chat (sem mudar `activeApp` / shell). */
  devStudioPreviewOpen: boolean;
  openDevStudioPreview: () => void;
  closeDevStudioPreview: () => void;
  setDevStudioPreviewOpen: (open: boolean) => void;
  /** Projecto Vite/React no disco (preview do estúdio). */
  devStudioWorkspacePath: string | null;
  devStudioProjectTitle: string | null;
  setDevStudioProject: (workspacePath: string | null, title?: string | null) => void;
  clearDevStudio: () => void;
  /** Incrementado quando o projecto muda — força reinício do preview. */
  devStudioPreviewGeneration: number;
  /** Reinicia o Vite no mesmo projecto (ex.: reabrir a mesma conversa). */
  restartDevStudioPreview: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [activeApp, setActiveAppState] = useState<AppId | null>(null);
  const [dashboardData, setDashboardDataState] = useState<DashboardData | null>(null);
  const [taskListsPreviewOpen, setTaskListsPreviewOpen] = useState(false);
  const [taskListsPreviewNonce, setTaskListsPreviewNonce] = useState(0);
  const [devStudioWorkspacePath, setDevStudioWorkspacePathState] = useState<string | null>(
    null,
  );
  const [devStudioProjectTitle, setDevStudioProjectTitleState] = useState<string | null>(
    null,
  );
  const [devStudioPreviewGeneration, setDevStudioPreviewGeneration] = useState(0);
  const [devStudioPreviewOpen, setDevStudioPreviewOpen] = useState(false);
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
      setDevStudioWorkspacePathState(null);
      setDevStudioProjectTitleState(null);
      setDevStudioPreviewGeneration(0);
      setDevStudioPreviewOpen(false);
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

  const openDevStudioPreview = useCallback(() => {
    setDevStudioPreviewOpen(true);
  }, []);

  const closeDevStudioPreview = useCallback(() => {
    setDevStudioPreviewOpen(false);
  }, []);

  const setDevStudioPreviewOpenCb = useCallback((open: boolean) => {
    setDevStudioPreviewOpen(open);
  }, []);

  const resetShellLayout = useCallback(() => {
    setActiveAppState(null);
    setDashboardDataState(null);
    setTaskListsPreviewOpen(false);
    setTaskListsPreviewNonce(0);
    setDevStudioWorkspacePathState(null);
    setDevStudioProjectTitleState(null);
    setDevStudioPreviewGeneration(0);
    setDevStudioPreviewOpen(false);
  }, []);

  const setDevStudioProject = useCallback(
    (workspacePath: string | null, title?: string | null) => {
      const next = workspacePath?.trim() ?? "";
      setDevStudioWorkspacePathState((prev) => {
        const prevNorm = prev?.trim() ?? "";
        if (next && next !== prevNorm) {
          setDevStudioPreviewGeneration((n) => n + 1);
        }
        return workspacePath;
      });
      setDevStudioProjectTitleState(title ?? null);
    },
    [],
  );

  const restartDevStudioPreview = useCallback(() => {
    setDevStudioPreviewGeneration((n) => n + 1);
  }, []);

  const clearDevStudio = useCallback(() => {
    setDevStudioWorkspacePathState(null);
    setDevStudioProjectTitleState(null);
    setDevStudioPreviewGeneration(0);
    setDevStudioPreviewOpen(false);
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
      devStudioPreviewOpen,
      openDevStudioPreview,
      closeDevStudioPreview,
      setDevStudioPreviewOpen: setDevStudioPreviewOpenCb,
      devStudioWorkspacePath,
      devStudioProjectTitle,
      setDevStudioProject,
      clearDevStudio,
      devStudioPreviewGeneration,
      restartDevStudioPreview,
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
      devStudioPreviewOpen,
      openDevStudioPreview,
      closeDevStudioPreview,
      setDevStudioPreviewOpenCb,
      devStudioWorkspacePath,
      devStudioProjectTitle,
      setDevStudioProject,
      clearDevStudio,
      devStudioPreviewGeneration,
      restartDevStudioPreview,
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
