/**
 * Ponte tipada para as APIs Electron expostas pelo preload.cjs.
 *
 * Só disponível quando a app corre no shell Electron (window.smartagent.isElectron).
 * Em modo web (browser puro) todas as funções retornam valores neutros.
 */

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type ServiceStatus =
  | "running"     // processo filho activo
  | "stopped"     // parado (não iniciado ou terminado limpo)
  | "starting"    // a arrancar
  | "crashed"     // terminado com código de erro (a reiniciar com backoff)
  | "restarting"  // a aguardar backoff antes de reiniciar
  | "external"    // modo dev — serviço assumido como externo
  | "missing"     // binário não encontrado em resources/
  | "error";      // erro ao arrancar

export interface ServicesState {
  api: ServiceStatus;
  intelligence: ServiceStatus;
}

export interface ServiceStatusEvent {
  name: "api" | "intelligence";
  status: ServiceStatus;
  /** Linha de log (eventos "log") */
  line?: string;
  isError?: boolean;
  /** Mensagem de erro (eventos "error") */
  message?: string;
  /** Atraso do backoff em ms (eventos "restarting") */
  delayMs?: number;
  /** Caminho do binário em falta (eventos "missing") */
  path?: string;
  /** Código de saída (eventos "crashed") */
  code?: number | null;
}

export type ServiceLogLine = { ts: number; line: string; isError: boolean };

export type ServicesDiagnostics = {
  isDev: boolean;
  resourcesPath: string;
  api: { status: ServiceStatus; logs: ServiceLogLine[] };
  intelligence: { status: ServiceStatus; logs: ServiceLogLine[] };
};

// ── Acesso tipado ao bridge ────────────────────────────────────────────────────

function bridge() {
  return typeof window !== "undefined" ? (window as any).smartagent : null;
}

export function isElectron(): boolean {
  return Boolean(bridge()?.isElectron);
}

// ── Assistente de primeira execução (instalação empacotada) ───────────────────

export type DesktopFirstRunPayload = {
  /** Chave OpenAI — opcional; pode ser configurada mais tarde em Definições > LLM. */
  openaiApiKey?: string;
  /** Chave Google — opcional; pode ser configurada mais tarde em Definições > LLM. */
  googleApiKey?: string;
  adminEmail: string;
};

export type DesktopFirstRunResult = {
  ok: boolean;
  adminEmail?: string;
  adminPassword?: string;
  error?: string;
};

export const desktopSetup = {
  needsFirstRunSetup: (): Promise<boolean> =>
    bridge()?.desktop?.needsFirstRunSetup() ?? Promise.resolve(false),
  writeFirstRunSetup: (payload: DesktopFirstRunPayload): Promise<DesktopFirstRunResult> =>
    bridge()?.desktop?.writeFirstRunSetup(payload) ??
    Promise.resolve({ ok: false, error: "Not in Electron" }),
  /** Apaga ficheiros .env e BD local para reiniciar a configuração (recuperação de instalação falhada). */
  resetSetup: (): Promise<{ ok: boolean; error?: string }> =>
    bridge()?.desktop?.resetSetup?.() ?? Promise.resolve({ ok: false, error: "Not in Electron" }),
};

// ── Credenciais ────────────────────────────────────────────────────────────────

export const desktopCredentials = {
  isEncryptionAvailable: (): Promise<boolean> =>
    bridge()?.credentials?.isEncryptionAvailable() ?? Promise.resolve(false),
  save: (payload: { email: string; password: string }) =>
    bridge()?.credentials?.save(payload) ?? Promise.resolve({ ok: false, error: "Not in Electron" }),
  load: (): Promise<{ ok: boolean; data: { email: string; password: string } | null }> =>
    bridge()?.credentials?.load() ?? Promise.resolve({ ok: true, data: null }),
  clear: () =>
    bridge()?.credentials?.clear() ?? Promise.resolve({ ok: true }),
};

// ── Controlo da app ────────────────────────────────────────────────────────────

export const desktopApp = {
  getAutoLaunch: (): Promise<boolean> =>
    bridge()?.app?.getAutoLaunch() ?? Promise.resolve(false),
  setAutoLaunch: (enabled: boolean): Promise<boolean> =>
    bridge()?.app?.setAutoLaunch(enabled) ?? Promise.resolve(false),
  show: (): Promise<void> =>
    bridge()?.app?.show() ?? Promise.resolve(),
  hide: (): Promise<void> =>
    bridge()?.app?.hide() ?? Promise.resolve(),
  quit: (): Promise<void> =>
    bridge()?.app?.quit() ?? Promise.resolve(),
  checkForUpdates: (): Promise<{ ok: boolean; error?: string }> =>
    bridge()?.app?.checkForUpdates() ?? Promise.resolve({ ok: false, error: "Not in Electron" }),
};

// ── Estado dos serviços ────────────────────────────────────────────────────────

export const desktopServices = {
  getStatus: (): Promise<ServicesState> =>
    bridge()?.services?.getStatus() ?? Promise.resolve({ api: "external", intelligence: "external" }),
  getDiagnostics: (): Promise<ServicesDiagnostics> =>
    bridge()?.services?.getDiagnostics?.() ??
    Promise.resolve({
      isDev: true,
      resourcesPath: "",
      api: { status: "external", logs: [] },
      intelligence: { status: "external", logs: [] },
    }),
  restartAll: (): Promise<ServicesState> =>
    bridge()?.services?.restartAll?.() ?? Promise.resolve({ api: "external", intelligence: "external" }),
  onStatusChanged: (callback: (event: ServiceStatusEvent) => void): (() => void) => {
    const unsub = bridge()?.services?.onStatusChanged(callback);
    return unsub ?? (() => { });
  },
};

// ── Logs persistentes (Electron) ───────────────────────────────────────────────

type LogsPathsResult = { ok: true; dir: string; file: string } | { ok: false; error: string };
type LogsReadResult = { ok: true; text: string } | { ok: false; error: string; text: string };
type LogsAppendResult = { ok: true } | { ok: false; error: string };

export const desktopLogs = {
  getPaths: async (): Promise<LogsPathsResult> => {
    const b = bridge();
    if (!b?.logs?.getPaths) return { ok: false, error: "Not in Electron" };
    return (await b.logs.getPaths()) as LogsPathsResult;
  },
  readTail: async (maxBytes = 64_000): Promise<LogsReadResult> => {
    const b = bridge();
    if (!b?.logs?.readTail) return { ok: false, error: "Not in Electron", text: "" };
    return (await b.logs.readTail(maxBytes)) as LogsReadResult;
  },
  append: async (scope: string, message: string): Promise<LogsAppendResult> => {
    const b = bridge();
    if (!b?.logs?.append) return { ok: false, error: "Not in Electron" };
    return (await b.logs.append({ scope, message })) as LogsAppendResult;
  },
  openFolder: async (): Promise<{ ok: true; dir: string } | { ok: false; error: string }> => {
    const b = bridge();
    if (!b?.logs?.openFolder) return { ok: false, error: "Not in Electron" };
    return (await b.logs.openFolder()) as any;
  },
  revealFile: async (): Promise<{ ok: true; file: string } | { ok: false; error: string }> => {
    const b = bridge();
    if (!b?.logs?.revealFile) return { ok: false, error: "Not in Electron" };
    return (await b.logs.revealFile()) as any;
  },
};

export const desktopClipboard = {
  writeText: async (text: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const b = bridge();
    if (!b?.clipboard?.writeText) return { ok: false, error: "Not in Electron" };
    return (await b.clipboard.writeText(text)) as any;
  },
};

// ── Polvo Code (Electron): projecto em disco + npm/vite ─────────────────────────

export type PolvoCodeWriteResult =
  | { ok: true; workspacePath: string }
  | { ok: false; error?: string };

export type PolvoCodeChooseFolderResult =
  | { ok: true; workspacePath: string }
  | { ok: false; canceled?: boolean; error?: string };

export type PolvoCodeSimpleResult = { ok: boolean; error?: string; code?: number | null };

export type PolvoCodeDevStartOpts = {
  workspacePath: string;
  port?: number;
  /** Abre o URL no navegador quando o Vite imprimir o endereço local. */
  openBrowser?: boolean;
};

export type PolvoCodeEvent =
  | { type: "log"; line: string }
  | { type: "url"; url: string }
  | { type: "exit"; code: number | null; phase?: string };

export type PolvoCodeDirEntry = {
  name: string;
  relPath: string;
  isDirectory: boolean;
};

export type PolvoCodeListDirResult =
  | { ok: true; entries: PolvoCodeDirEntry[] }
  | { ok: false; error?: string };

export type PolvoCodeReadFileResult =
  | { ok: true; content: string }
  | { ok: false; error?: string };

export const desktopPolvoCode = {
  writeProject: async (payload: {
    title: string;
    files: { path: string; content: string }[];
  }): Promise<PolvoCodeWriteResult> => {
    const b = bridge();
    if (!b?.polvoCode?.writeProject) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.writeProject(payload)) as PolvoCodeWriteResult;
  },

  chooseProjectFolder: async (): Promise<PolvoCodeChooseFolderResult> => {
    const b = bridge();
    if (!b?.polvoCode?.chooseProjectFolder) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.chooseProjectFolder()) as PolvoCodeChooseFolderResult;
  },

  npmInstall: async (workspacePath: string): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.npmInstall) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.npmInstall(workspacePath)) as PolvoCodeSimpleResult;
  },

  devStart: async (opts: PolvoCodeDevStartOpts): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.devStart) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.devStart(opts)) as PolvoCodeSimpleResult;
  },

  devStop: async (): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.devStop) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.devStop()) as PolvoCodeSimpleResult;
  },

  openExternal: async (url: string): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.openExternal) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.openExternal(url)) as PolvoCodeSimpleResult;
  },

  revealInExplorer: async (projectPath: string): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.revealInExplorer) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.revealInExplorer(projectPath)) as PolvoCodeSimpleResult;
  },

  tryOpenExternalEditor: async (
    workspacePath: string,
  ): Promise<{ ok: boolean; error?: string; command?: string }> => {
    const b = bridge();
    if (!b?.polvoCode?.tryOpenExternalEditor) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.tryOpenExternalEditor(workspacePath)) as {
      ok: boolean;
      error?: string;
      command?: string;
    };
  },

  listDir: async (payload: {
    workspacePath: string;
    relPath?: string;
  }): Promise<PolvoCodeListDirResult> => {
    const b = bridge();
    if (!b?.polvoCode?.listDir) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.listDir(payload)) as PolvoCodeListDirResult;
  },

  readFile: async (payload: {
    workspacePath: string;
    relPath: string;
  }): Promise<PolvoCodeReadFileResult> => {
    const b = bridge();
    if (!b?.polvoCode?.readFile) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.readFile(payload)) as PolvoCodeReadFileResult;
  },

  writeFile: async (payload: {
    workspacePath: string;
    relPath: string;
    content: string;
    createDirs?: boolean;
  }): Promise<PolvoCodeSimpleResult> => {
    const b = bridge();
    if (!b?.polvoCode?.writeFile) return { ok: false, error: "Not in Electron" };
    return (await b.polvoCode.writeFile(payload)) as PolvoCodeSimpleResult;
  },

  onEvent: (callback: (ev: PolvoCodeEvent) => void): (() => void) => {
    const b = bridge();
    if (!b?.polvoCode?.onEvent) return () => {};
    return b.polvoCode.onEvent((payload: Record<string, unknown>) => {
      callback(payload as PolvoCodeEvent);
    });
  },
};

// ── Label de estado legível ────────────────────────────────────────────────────

export function serviceStatusLabel(status: ServiceStatus): string {
  switch (status) {
    case "running":     return "Em execução";
    case "stopped":     return "Parado";
    case "starting":    return "A arrancar…";
    case "crashed":     return "Falha (a reiniciar)";
    case "restarting":  return "A reiniciar…";
    case "external":    return "Externo (dev)";
    case "missing":     return "Binário não encontrado";
    case "error":       return "Erro";
  }
}

export function serviceStatusColor(status: ServiceStatus): string {
  switch (status) {
    case "running":     return "text-emerald-600 dark:text-emerald-400";
    case "external":    return "text-blue-600 dark:text-blue-400";
    case "starting":
    case "restarting":  return "text-amber-600 dark:text-amber-400";
    case "stopped":
    case "crashed":
    case "missing":
    case "error":       return "text-red-600 dark:text-red-400";
  }
}
