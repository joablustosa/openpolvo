const { contextBridge, ipcRenderer } = require("electron");

/** Injecção via `webPreferences.additionalArguments` (main.cjs) para alinhar com userData/backend.env. */
function parseOpenPolvoApiBaseFromArgv() {
  try {
    const prefix = "--open-polvo-api-base=";
    const raw = process.argv.find((a) => typeof a === "string" && a.startsWith(prefix));
    if (!raw) return null;
    return decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return null;
  }
}

const apiBaseUrlOverride = parseOpenPolvoApiBaseFromArgv();

/**
 * Ponte segura entre o processo principal e o renderer (React).
 *
 * Namespaces:
 *  - smartagent.credentials  → safeStorage (cifra de credenciais)
 *  - smartagent.app          → controlo da janela + auto-launch
 */
contextBridge.exposeInMainWorld("smartagent", {
  /** Presente só no shell Electron; usado para ajustar comportamento da UI. */
  isElectron: true,
  platform: process.platform,
  /** Empacotado: URL absoluta da API Go (null em dev ou builds antigas). */
  apiBaseUrlOverride,

  // ── Credenciais cifradas (safeStorage) ──────────────────────────────────────
  credentials: {
    isEncryptionAvailable: () =>
      ipcRenderer.invoke("credentials:isEncryptionAvailable"),
    save: (payload) => ipcRenderer.invoke("credentials:save", payload),
    load: () => ipcRenderer.invoke("credentials:load"),
    clear: () => ipcRenderer.invoke("credentials:clear"),
  },

  // ── Controlo da aplicação ────────────────────────────────────────────────────
  app: {
    /** Retorna true se a app está configurada para arrancar com o sistema. */
    getAutoLaunch: () => ipcRenderer.invoke("app:getAutoLaunch"),
    /**
     * Activa ou desactiva o arranque automático ao iniciar o sistema.
     * @param {boolean} enabled
     * @returns {Promise<boolean>} estado actual após a alteração
     */
    setAutoLaunch: (enabled) => ipcRenderer.invoke("app:setAutoLaunch", enabled),
    /** Mostra e foca a janela principal. */
    show: () => ipcRenderer.invoke("app:show"),
    /** Esconde a janela para a tray (os serviços continuam a correr). */
    hide: () => ipcRenderer.invoke("app:hide"),
    /** Para os serviços e encerra completamente a aplicação. */
    quit: () => ipcRenderer.invoke("app:quit"),
    /** Verifica actualizações (GitHub Releases) — só empacotado. */
    checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  },

  // ── Logs persistentes (suporte/diagnóstico) ──────────────────────────────────
  logs: {
    getPaths: () => ipcRenderer.invoke("logs:getPaths"),
    readTail: (maxBytes) => ipcRenderer.invoke("logs:readTail", { maxBytes }),
    append: (payload) => ipcRenderer.invoke("logs:append", payload),
    openFolder: () => ipcRenderer.invoke("logs:openFolder"),
    revealFile: () => ipcRenderer.invoke("logs:revealFile"),
  },

  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:writeText", { text }),
  },

  /** Polvo Code — workspace local, npm/vite, abrir no navegador / editor externo */
  polvoCode: {
    writeProject: (payload) => ipcRenderer.invoke("polvoCode:writeProject", payload),
    chooseProjectFolder: () => ipcRenderer.invoke("polvoCode:chooseProjectFolder"),
    npmInstall: (workspacePath) =>
      ipcRenderer.invoke("polvoCode:npmInstall", { workspacePath }),
    devStart: (opts) => ipcRenderer.invoke("polvoCode:devStart", opts),
    devStop: () => ipcRenderer.invoke("polvoCode:devStop"),
    openExternal: (url) => ipcRenderer.invoke("polvoCode:openExternal", { url }),
    revealInExplorer: (projectPath) =>
      ipcRenderer.invoke("polvoCode:revealInExplorer", { path: projectPath }),
    tryOpenExternalEditor: (workspacePath) =>
      ipcRenderer.invoke("polvoCode:tryOpenExternalEditor", { workspacePath }),
    listDir: (payload) => ipcRenderer.invoke("polvoCode:listDir", payload),
    readFile: (payload) => ipcRenderer.invoke("polvoCode:readFile", payload),
    writeFile: (payload) => ipcRenderer.invoke("polvoCode:writeFile", payload),
    /**
     * Subscreve eventos do runner (`log`, `url`, `exit`).
     * @param {(ev: { type: string } & Record<string, unknown>) => void} callback
     * @returns {() => void} cleanup
     */
    onEvent: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("polvoCode:event", handler);
      return () => ipcRenderer.removeListener("polvoCode:event", handler);
    },
  },
});
