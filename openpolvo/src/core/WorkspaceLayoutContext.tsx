import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const RIGHT_COLLAPSED_KEY = "smartagent_right_panel_collapsed";

type WorkspaceLayoutContextValue = {
  rightPanelCollapsed: boolean;
  collapseRightPanel: () => void;
  expandRightPanel: () => void;
};

const WorkspaceLayoutContext =
  createContext<WorkspaceLayoutContextValue | null>(null);

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(RIGHT_COLLAPSED_KEY) === "1";
  });

  const collapseRightPanel = useCallback(() => {
    setRightPanelCollapsed(true);
    try {
      localStorage.setItem(RIGHT_COLLAPSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const expandRightPanel = useCallback(() => {
    setRightPanelCollapsed(false);
    try {
      localStorage.setItem(RIGHT_COLLAPSED_KEY, "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      rightPanelCollapsed,
      collapseRightPanel,
      expandRightPanel,
    }),
    [rightPanelCollapsed, collapseRightPanel, expandRightPanel],
  );

  return (
    <WorkspaceLayoutContext.Provider value={value}>
      {children}
    </WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayout(): WorkspaceLayoutContextValue {
  const ctx = useContext(WorkspaceLayoutContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceLayout deve estar dentro de WorkspaceLayoutProvider",
    );
  }
  return ctx;
}

export function useWorkspaceLayoutOptional(): WorkspaceLayoutContextValue | null {
  return useContext(WorkspaceLayoutContext);
}
