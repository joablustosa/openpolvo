const { contextBridge, ipcRenderer } = require("electron");

const envApi =
  typeof process.env.OPEN_LA_ELE_API_URL === "string"
    ? process.env.OPEN_LA_ELE_API_URL.trim()
    : "";

/**
 * Ponte segura entre o processo principal e o renderer (React).
 *
 * Namespaces:
 *  - smartagent.credentials  → safeStorage (cifra de credenciais)
 *  - smartagent.app          → controlo da janela + auto-launch
 *  - smartagent.services     → estado dos serviços backend (Go API, Python Intelligence)
 */
contextBridge.exposeInMainWorld("smartagent", {
  /** Presente só no shell Electron; usado para ajustar comportamento da UI. */
  isElectron: true,
  platform: process.platform,
  /** URL base da API (configurável via OPEN_LA_ELE_API_URL antes de arrancar). */
  apiBaseUrl: envApi !== "" ? envApi.replace(/\/+$/, "") : null,

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
  },

  // ── Estado dos serviços backend ──────────────────────────────────────────────
  services: {
    /**
     * Retorna o estado actual de cada serviço.
     * @returns {Promise<{api: string, intelligence: string}>}
     *   Estado: "running" | "stopped" | "starting" | "crashed" | "external" | "missing"
     */
    getStatus: () => ipcRenderer.invoke("services:getStatus"),
    /**
     * Subscreve a actualizações em tempo real do estado dos serviços.
     * @param {(event: {name: string, status: string}) => void} callback
     * @returns {() => void} função para cancelar a subscrição
     */
    onStatusChanged: (callback) => {
      const handler = (_, event) => callback(event);
      ipcRenderer.on("services:statusChanged", handler);
      return () => ipcRenderer.removeListener("services:statusChanged", handler);
    },
  },
});
