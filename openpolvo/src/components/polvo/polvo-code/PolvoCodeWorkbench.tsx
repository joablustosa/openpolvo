import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKb,
} from "react";
import Editor from "@monaco-editor/react";
import * as monacoApi from "monaco-editor";
import {
  Code2,
  ExternalLink,
  FolderOpen,
  Loader2,
  PanelBottom,
  SquareTerminal,
  StopCircle,
  Files,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/core/WorkspaceContext";
import {
  desktopPolvoCode,
  isElectron,
  type PolvoCodeEvent,
} from "@/lib/desktopApi";
import { cn } from "@/lib/utils";
import { PolvoCodeExplorer } from "./PolvoCodeExplorer";
import { configureMonacoWorkers } from "./monacoBootstrap";
import { detectLanguage } from "./detectLanguage";

let monacoConfigured = false;
function ensureMonacoTheme() {
  if (monacoConfigured) return;
  configureMonacoWorkers();
  monacoConfigured = true;
}

type TabModel = {
  relPath: string;
  content: string;
  dirty: boolean;
  loading?: boolean;
};

type Props = {
  onClose?: () => void;
};

export function PolvoCodeWorkbench({ onClose }: Props) {
  ensureMonacoTheme();

  const {
    polvoCodeWorkspacePath,
    polvoCodeProjectTitle,
    clearPolvoCode,
    setActiveApp,
    setPolvoCodeProject,
  } = useWorkspace();

  const [log, setLog] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [running, setRunning] = useState(false);
  const [port] = useState(5175);
  const logRef = useRef<HTMLPreElement | null>(null);

  const [tabs, setTabs] = useState<TabModel[]>([]);
  const tabsRef = useRef<TabModel[]>([]);
  tabsRef.current = tabs;
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [explorerExpanded, setExplorerExpanded] = useState(() => new Set<string>());
  const [sidebarMode, setSidebarMode] = useState<"explorer" | "hidden">("explorer");
  const [terminalHeight, setTerminalHeight] = useState(200);
  const terminalResizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const activeTab = tabs[activeTabIndex] ?? null;

  const workspacePath = polvoCodeWorkspacePath ?? "";

  const appendLog = useCallback((chunk: string) => {
    setLog((prev) => (prev + chunk).slice(-96_000));
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    const unsub = desktopPolvoCode.onEvent((ev: PolvoCodeEvent) => {
      if (ev.type === "log" && typeof ev.line === "string") {
        appendLog(ev.line);
      } else if (ev.type === "url" && typeof ev.url === "string") {
        setDevUrl(ev.url);
      } else if (ev.type === "exit") {
        const phase = "phase" in ev ? String((ev as { phase?: string }).phase ?? "") : "";
        if (phase === "install") setInstalling(false);
        else setRunning(false);
      }
    });
    return unsub;
  }, [appendLog]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  const openFile = useCallback(
    async (relPath: string) => {
      const prev = tabsRef.current;
      const existing = prev.findIndex((t) => t.relPath === relPath);
      if (existing >= 0) {
        setActiveTabIndex(existing);
        return;
      }
      const newIdx = prev.length;
      setTabs([
        ...prev,
        { relPath, content: "", dirty: false, loading: true },
      ]);
      setActiveTabIndex(newIdx);

      const r = await desktopPolvoCode.readFile({
        workspacePath,
        relPath,
      });
      setTabs((cur) =>
        cur.map((t) =>
          t.relPath === relPath
            ? r.ok
              ? { ...t, content: r.content, dirty: false, loading: false }
              : {
                  ...t,
                  content: `/* ${r.error ?? "Erro ao ler"} */`,
                  dirty: false,
                  loading: false,
                }
            : t,
        ),
      );
    },
    [workspacePath],
  );

  const saveActive = useCallback(async () => {
    const t = tabs[activeTabIndex];
    if (!t?.relPath || !workspacePath || t.loading) return;
    const r = await desktopPolvoCode.writeFile({
      workspacePath,
      relPath: t.relPath,
      content: t.content,
      createDirs: true,
    });
    if (r.ok) {
      setTabs((prev) =>
        prev.map((x, i) => (i === activeTabIndex ? { ...x, dirty: false } : x)),
      );
    } else {
      appendLog(`\n[gravar] ${t.relPath}: ${r.error ?? "falhou"}\n`);
    }
  }, [tabs, activeTabIndex, workspacePath, appendLog]);

  const closeTab = useCallback((idx: number) => {
    setTabs((current) => {
      const t = current[idx];
      if (!t) return current;
      if (
        t.dirty &&
        !window.confirm(
          `«${t.relPath}» tem alterações não gravadas. Fechar mesmo assim?`,
        )
      ) {
        return current;
      }
      const next = current.filter((_, i) => i !== idx);
      queueMicrotask(() => {
        setActiveTabIndex((prevIdx) => {
          if (prevIdx === idx) return Math.max(0, next.length - 1);
          if (prevIdx > idx) return prevIdx - 1;
          return prevIdx;
        });
      });
      return next;
    });
  }, []);

  const pickFolder = async () => {
    const r = await desktopPolvoCode.chooseProjectFolder();
    if (r.ok && r.workspacePath) {
      setPolvoCodeProject(r.workspacePath, null);
      setTabs([]);
      setActiveTabIndex(0);
      setActiveApp("polvo_code");
    }
  };

  const handleInstall = async () => {
    if (!workspacePath) return;
    setInstalling(true);
    appendLog("\n--- npm install ---\n");
    const r = await desktopPolvoCode.npmInstall(workspacePath);
    setInstalling(false);
    if (!r.ok && r.error) appendLog(`\n${r.error}\n`);
  };

  const handleDevStart = async (openBrowser: boolean) => {
    if (!workspacePath) return;
    setRunning(true);
    setDevUrl(null);
    appendLog(`\n--- npm run dev (porta ${port}) ---\n`);
    const r = await desktopPolvoCode.devStart({
      workspacePath,
      port,
      openBrowser,
    });
    if (!r.ok && r.error) {
      appendLog(`\n${r.error}\n`);
      setRunning(false);
    }
  };

  const handleDevStop = async () => {
    await desktopPolvoCode.devStop();
    setRunning(false);
  };

  const handleClosePanel = () => {
    void desktopPolvoCode.devStop();
    clearPolvoCode();
    setActiveApp(null);
    setTabs([]);
    onClose?.();
  };

  const onMountEditor = useCallback(
    (editor: monacoApi.editor.IStandaloneCodeEditor, monaco: typeof monacoApi) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveActive();
      });
    },
    [saveActive],
  );

  const handleKeyDownRoot = useCallback(
    (e: ReactKb<HTMLDivElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActive();
      }
    },
    [saveActive],
  );

  const terminalDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      terminalResizeRef.current = {
        startY: e.clientY,
        startH: terminalHeight,
      };
      const onMove = (ev: MouseEvent) => {
        const r = terminalResizeRef.current;
        if (!r) return;
        const dy = r.startY - ev.clientY;
        const next = Math.min(480, Math.max(80, r.startH + dy));
        setTerminalHeight(next);
      };
      const onUp = () => {
        terminalResizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [terminalHeight],
  );

  const editorValue = activeTab?.loading ? "" : (activeTab?.content ?? "");
  const language = useMemo(
    () => (activeTab ? detectLanguage(activeTab.relPath) : "plaintext"),
    [activeTab],
  );

  if (!isElectron()) {
    return null;
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc]"
      aria-label="Polvo Code"
      onKeyDown={handleKeyDownRoot}
    >
      {/* Title bar */}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#474747] bg-[#323233] px-2">
        <Code2 className="size-4 shrink-0 opacity-90" />
        <span className="truncate text-[13px] font-medium">
          {polvoCodeProjectTitle?.trim() || "Polvo Code"}
        </span>
        <Badge variant="outline" className="border-[#474747] text-[10px] text-muted-foreground">
          IDE
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-[#cccccc] hover:bg-[#474747]"
            onClick={() => void pickFolder()}
          >
            <FolderOpen className="size-3.5" />
            Pasta…
          </Button>
          {workspacePath ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-[#cccccc] hover:bg-[#474747]"
              disabled={installing}
              onClick={() => void handleInstall()}
            >
              {installing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <SquareTerminal className="size-3.5" />
              )}
              npm install
            </Button>
          ) : null}
          {workspacePath ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={running}
                onClick={() => void handleDevStart(false)}
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Dev
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-[#cccccc] hover:bg-[#474747]"
                onClick={() => void handleDevStop()}
              >
                <StopCircle className="size-3.5" />
              </Button>
            </>
          ) : null}
          {devUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-emerald-400 hover:bg-[#474747]"
              onClick={() => void desktopPolvoCode.openExternal(devUrl)}
            >
              <ExternalLink className="size-3.5" />
              Abrir URL
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-[#cccccc] hover:bg-[#474747]"
            onClick={() => void saveActive()}
            disabled={!activeTab?.dirty}
          >
            Gravar
          </Button>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={handleClosePanel}
            >
              Fechar
            </Button>
          ) : null}
        </div>
      </header>

      {!workspacePath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#252526] p-8 text-center">
          <p className="max-w-md text-[13px] text-[#969696]">
            Gera uma aplicação no chat ou escolhe uma pasta com um projecto existente.
          </p>
          <Button type="button" onClick={() => void pickFolder()} className="gap-2">
            <FolderOpen className="size-4" />
            Escolher pasta do projecto
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Activity bar */}
          <nav
            className="flex w-[48px] shrink-0 flex-col items-center gap-1 border-r border-[#474747] bg-[#333333] py-2"
            aria-label="Vistas"
          >
            <button
              type="button"
              title="Explorador"
              className={cn(
                "flex size-10 items-center justify-center rounded border border-transparent",
                sidebarMode === "explorer"
                  ? "border-[#474747] bg-[#252526] text-[#cccccc]"
                  : "text-[#969696] hover:text-[#cccccc]",
              )}
              onClick={() => setSidebarMode(sidebarMode === "explorer" ? "hidden" : "explorer")}
            >
              <Files className="size-[22px]" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              title="Painel inferior (terminal)"
              className="flex size-10 items-center justify-center rounded text-[#969696] hover:bg-[#252526] hover:text-[#cccccc]"
              onClick={() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
            >
              <PanelBottom className="size-[22px]" strokeWidth={1.5} />
            </button>
          </nav>

          {/* Sidebar */}
          {sidebarMode === "explorer" ? (
            <aside className="flex w-[220px] shrink-0 flex-col border-r border-[#474747] bg-[#252526]">
              <PolvoCodeExplorer
                workspacePath={workspacePath}
                expanded={explorerExpanded}
                onExpandedChange={setExplorerExpanded}
                onOpenFile={(rel) => void openFile(rel)}
              />
            </aside>
          ) : null}

          {/* Editor column */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e]">
            {/* Tabs */}
            <div className="flex h-9 shrink-0 flex-nowrap gap-px overflow-x-auto bg-[#252526] pt-1">
              {tabs.map((tab, idx) => (
                <button
                  key={tab.relPath}
                  type="button"
                  className={cn(
                    "flex max-w-[200px] shrink-0 items-center gap-1 px-3 py-1 text-[12px]",
                    idx === activeTabIndex
                      ? "border-t border-[#007fd4] bg-[#1e1e1e] text-[#cccccc]"
                      : "border border-transparent bg-[#2d2d2d] text-[#969696] hover:bg-[#383838]",
                  )}
                  onClick={() => setActiveTabIndex(idx)}
                >
                  <span className="truncate">{tab.relPath.split("/").pop() ?? tab.relPath}</span>
                  {tab.dirty ? (
                    <span className="size-2 shrink-0 rounded-full bg-[#cccccc]" aria-hidden />
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-0.5 shrink-0 rounded p-0.5 hover:bg-[#474747]"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(idx);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        closeTab(idx);
                      }
                    }}
                  >
                    <X className="size-3.5 opacity-70" />
                  </span>
                </button>
              ))}
              {tabs.length === 0 ? (
                <span className="flex items-center px-3 py-1 text-[12px] text-[#969696]">
                  Sem ficheiros abertos — escolha um ficheiro no explorador
                </span>
              ) : null}
            </div>

            <div className="relative min-h-0 flex-1">
              {activeTab ? (
                <Editor
                  height="100%"
                  theme="polvo-dark"
                  language={language}
                  path={activeTab.relPath}
                  value={editorValue}
                  loading={<div className="p-4 text-[13px] text-[#969696]">A carregar…</div>}
                  options={{
                    minimap: { enabled: true },
                    fontSize: 13,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    renderWhitespace: "selection",
                  }}
                  onMount={onMountEditor}
                  onChange={(v) => {
                    const val = v ?? "";
                    setTabs((prev) =>
                      prev.map((x, i) =>
                        i === activeTabIndex ? { ...x, content: val, dirty: true } : x,
                      ),
                    );
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-[#969696]">
                  Sem ficheiro activo
                </div>
              )}
            </div>

            {/* Resize terminal */}
            <button
              type="button"
              aria-label="Redimensionar terminal"
              className="h-1 shrink-0 cursor-ns-resize border-0 bg-[#474747] hover:bg-[#007fd4]"
              onMouseDown={terminalDragStart}
            />

            {/* Terminal */}
            <div
              className="flex shrink-0 flex-col overflow-hidden border-t border-[#474747] bg-[#1e1e1e]"
              style={{ height: terminalHeight }}
            >
              <div className="flex h-7 shrink-0 items-center border-b border-[#474747] bg-[#252526] px-2 text-[11px] font-medium uppercase tracking-wide text-[#969696]">
                Terminal
              </div>
              <pre
                ref={logRef}
                className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-[#cccccc]"
              >
                {log || "Sem saída. npm install / npm run dev aparece aqui."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
