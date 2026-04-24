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

// ── Acesso tipado ao bridge ────────────────────────────────────────────────────

function bridge() {
  return typeof window !== "undefined" ? (window as any).smartagent : null;
}

export function isElectron(): boolean {
  return Boolean(bridge()?.isElectron);
}

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
};

// ── Estado dos serviços ────────────────────────────────────────────────────────

export const desktopServices = {
  getStatus: (): Promise<ServicesState> =>
    bridge()?.services?.getStatus() ?? Promise.resolve({ api: "external", intelligence: "external" }),
  onStatusChanged: (callback: (event: ServiceStatusEvent) => void): (() => void) => {
    const unsub = bridge()?.services?.onStatusChanged(callback);
    return unsub ?? (() => { });
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
