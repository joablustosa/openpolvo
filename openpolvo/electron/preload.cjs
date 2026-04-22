const { contextBridge, ipcRenderer } = require("electron");

const envApi =
  typeof process.env.OPEN_LA_ELE_API_URL === "string"
    ? process.env.OPEN_LA_ELE_API_URL.trim()
    : "";

/**
 * Ponte mínima: plataforma, URL da API (opcional) para o renderer.
 * Defina OPEN_LA_ELE_API_URL antes de arrancar o Electron para forçar o host da API.
 */
contextBridge.exposeInMainWorld("smartagent", {
  /** Presente só no shell Electron; o renderer usa isto para embutir `<webview>` em vez de confiar só no user-agent. */
  isElectron: true,
  platform: process.platform,
  apiBaseUrl: envApi !== "" ? envApi.replace(/\/+$/, "") : null,
  /** Guardar / ler e-mail e senha com `safeStorage` (apenas processo principal). */
  credentials: {
    isEncryptionAvailable: () =>
      ipcRenderer.invoke("credentials:isEncryptionAvailable"),
    save: (payload) => ipcRenderer.invoke("credentials:save", payload),
    load: () => ipcRenderer.invoke("credentials:load"),
    clear: () => ipcRenderer.invoke("credentials:clear"),
  },
});
