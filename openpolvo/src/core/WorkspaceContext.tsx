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
import type { BuilderData, BuilderFile } from "@/lib/builderMetadata";

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
  /** Aplicação gerada pelo sub-grafo Builder (Lovable-like). */
  builderData: BuilderData | null;
  setBuilderData: (data: BuilderData | null) => void;
  /** Progresso do stream Builder: etapa actual enquanto gera. */
  builderProgress: { step: string; label: string } | null;
  setBuilderProgress: (p: { step: string; label: string } | null) => void;
  /** Ficheiros recebidos em stream antes do artefacto final estar pronto. */
  builderStreamFiles: BuilderFile[];
  setBuilderStreamFiles: (files: BuilderFile[] | ((prev: BuilderFile[]) => BuilderFile[])) => void;
  /** Preview de listas de tarefas ao lado do chat (respostas sobre to-do). */
  taskListsPreviewOpen: boolean;
  taskListsPreviewNonce: number;
  openTaskListsPreview: () => void;
  refreshTaskListsPreview: () => void;
  closeTaskListsPreview: () => void;
  /** Fecha builder, dashboard, plugin, preview de listas — volta ao layout da página inicial. */
  resetShellLayout: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [activeApp, setActiveAppState] = useState<AppId | null>(null);
  const [dashboardData, setDashboardDataState] = useState<DashboardData | null>(null);
  const [builderData, setBuilderDataState] = useState<BuilderData | null>(null);
  const [builderProgress, setBuilderProgressState] = useState<{ step: string; label: string } | null>(null);
  const [builderStreamFiles, setBuilderStreamFilesState] = useState<BuilderFile[]>([]);
  const [taskListsPreviewOpen, setTaskListsPreviewOpen] = useState(false);
  const [taskListsPreviewNonce, setTaskListsPreviewNonce] = useState(0);
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
      setBuilderDataState(null);
      setBuilderProgressState(null);
      setBuilderStreamFilesState([]);
      setTaskListsPreviewOpen(false);
      setTaskListsPreviewNonce(0);
    }
  }, [token]);

  const setActiveApp = useCallback((id: AppId | null) => {
    setActiveAppState(id);
  }, []);

  const setDashboardData = useCallback((data: DashboardData | null) => {
    setDashboardDataState(data);
  }, []);

  const setBuilderData = useCallback((data: BuilderData | null) => {
    setBuilderDataState(data);
  }, []);

  const setBuilderProgress = useCallback((p: { step: string; label: string } | null) => {
    setBuilderProgressState(p);
  }, []);

  const setBuilderStreamFiles = useCallback(
    (files: BuilderFile[] | ((prev: BuilderFile[]) => BuilderFile[])) => {
      setBuilderStreamFilesState(files);
    },
    [],
  );

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
    setBuilderDataState(null);
    setBuilderProgressState(null);
    setBuilderStreamFilesState([]);
    setTaskListsPreviewOpen(false);
    setTaskListsPreviewNonce(0);
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
      builderData,
      setBuilderData,
      builderProgress,
      setBuilderProgress,
      builderStreamFiles,
      setBuilderStreamFiles,
      taskListsPreviewOpen,
      taskListsPreviewNonce,
      openTaskListsPreview,
      refreshTaskListsPreview,
      closeTaskListsPreview,
      resetShellLayout,
    }),
    [
      activeApp,
      setActiveApp,
      sidebarCollapsed,
      toggleSidebar,
      setSidebarCollapsed,
      dashboardData,
      setDashboardData,
      builderData,
      setBuilderData,
      builderProgress,
      setBuilderProgress,
      builderStreamFiles,
      setBuilderStreamFiles,
      taskListsPreviewOpen,
      taskListsPreviewNonce,
      openTaskListsPreview,
      refreshTaskListsPreview,
      closeTaskListsPreview,
      resetShellLayout,
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
