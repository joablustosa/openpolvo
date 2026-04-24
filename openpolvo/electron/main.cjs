/**
 * Processo principal do Electron — Open Polvo.
 *
 * Responsabilidades:
 *  1. Arrancar os serviços backend (Go API + Python Intelligence) via processManager
 *  2. Criar o ícone de tray e gerir o ciclo de vida da janela (fechar → esconde na tray)
 *  3. Registar canais IPC (credenciais, controlo da app, estado dos serviços)
 *  4. Injectar headers COOP/COEP para crossOriginIsolated (WebContainers)
 *
 * Comportamento ao fechar a janela:
 *  - Clique no X → esconde para tray (os serviços continuam a correr)
 *  - "Sair" no menu da tray → para serviços + quit limpo
 *
 * Auto-launch:
 *  - Configurável via IPC app:setAutoLaunch ou toggle na tray
 *  - Usa app.setLoginItemSettings (openAsHidden: true → arranca sem janela visível)
 */

const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  session,
  ipcMain,
  safeStorage,
} = require("electron");
const path = require("path");
const fs = require("fs");

const { startAll, stopAll, getStatus, onStatus } = require("./processManager.cjs");
const { createTray, destroyTray, getAutoLaunchEnabled, setAutoLaunch } = require("./tray.cjs");

const isDev = !app.isPackaged;

// ── Constantes ─────────────────────────────────────────────────────────────────
const CREDS_FILENAME = "openpolvo-saved-login.enc";

// ── Ícone da aplicação ─────────────────────────────────────────────────────────
// Em dev: src/assets/oficial_logo.png
// Em prod: build/icon.png (copiado pelo electron-builder)
const iconPath = isDev
  ? path.join(__dirname, "..", "src", "assets", "oficial_logo.png")
  : path.join(__dirname, "..", "build", "icon.png");

const appIcon = (() => {
  try {
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  } catch { return undefined; }
})();

if (appIcon && process.platform === "darwin" && app.dock) {
  try { app.dock.setIcon(appIcon); } catch { }
}

// ── Estado global ──────────────────────────────────────────────────────────────
app.setName("Open Polvo");

/** true apenas quando o utilizador clica em "Sair" no menu da tray. */
let willQuit = false;

/** @type {BrowserWindow | null} */
let mainWindow = null;

// ── Helpers de credenciais ─────────────────────────────────────────────────────
function getCredsPath() {
  return path.join(app.getPath("userData"), CREDS_FILENAME);
}

// ── IPC: Credenciais cifradas (safeStorage) ────────────────────────────────────
function registerCredentialIpc() {
  ipcMain.handle("credentials:isEncryptionAvailable", () => {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  });

  ipcMain.handle("credentials:save", (_evt, payload) => {
    try {
      const email = typeof payload?.email === "string" ? payload.email.trim() : "";
      const password = typeof payload?.password === "string" ? payload.password : "";
      if (!email || password.length > 4096) return { ok: false, error: "Dados inválidos." };
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Cifra indisponível neste sistema." };
      const plain = JSON.stringify({ email, password });
      const buf = safeStorage.encryptString(plain);
      fs.writeFileSync(getCredsPath(), buf);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("credentials:load", () => {
    try {
      const p = getCredsPath();
      if (!fs.existsSync(p)) return { ok: true, data: null };
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Cifra indisponível.", data: null };
      const buf = fs.readFileSync(p);
      const plain = safeStorage.decryptString(buf);
      const data = JSON.parse(plain);
      if (typeof data?.email !== "string" || typeof data?.password !== "string") return { ok: true, data: null };
      return { ok: true, data: { email: data.email.trim(), password: data.password } };
    } catch {
      return { ok: true, data: null };
    }
  });

  ipcMain.handle("credentials:clear", () => {
    try {
      const p = getCredsPath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
}

// ── IPC: Controlo da App + Serviços ───────────────────────────────────────────
function registerAppIpc() {
  // Auto-launch ao iniciar o sistema
  ipcMain.handle("app:getAutoLaunch", () => getAutoLaunchEnabled());

  ipcMain.handle("app:setAutoLaunch", (_evt, enabled) => {
    setAutoLaunch(Boolean(enabled));
    return getAutoLaunchEnabled();
  });

  // Controlo da janela
  ipcMain.handle("app:show", () => {
    showMainWindow();
  });

  ipcMain.handle("app:hide", () => {
    mainWindow?.hide();
  });

  // Sair completamente (para serviços)
  ipcMain.handle("app:quit", () => {
    willQuit = true;
    stopAll();
    destroyTray();
    app.quit();
  });

  // Estado dos serviços backend
  ipcMain.handle("services:getStatus", () => getStatus());
}

// ── Janela principal ───────────────────────────────────────────────────────────
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: appIcon,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    // Se foi iniciado pelo sistema (autostart openAsHidden), não mostra janela
    const loginSettings = app.getLoginItemSettings();
    if (loginSettings.wasOpenedAsHidden) {
      // Permanece oculto — a tray é o único ponto de entrada
      return;
    }
    win.maximize();
    win.show();
  });

  // Fechar janela → esconde para tray (não sai da app)
  win.on("close", (e) => {
    if (!willQuit) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    win.loadURL("http://localhost:5174");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerCredentialIpc();
  registerAppIpc();

  // COOP / COEP obrigatório para crossOriginIsolated = true (WebContainers)
  // Em dev o Vite não serve estes headers via loadURL, por isso injectamos aqui.
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ["http://localhost:5174/*", "http://127.0.0.1:5174/*"] },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
        responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
        callback({ responseHeaders });
      },
    );
  }

  // Remove menu nativo — a UI usa componentes Shadcn (estilo Claude)
  Menu.setApplicationMenu(null);

  // ── Arrancar serviços backend ──────────────────────────────────────────────
  // Em dev reporta "external"; em prod arranca os binários compilados.
  startAll();

  // Reencaminhar eventos de estado dos serviços para o renderer via IPC
  onStatus((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send("services:statusChanged", event);
      } catch { /* janela pode estar a destruir-se */ }
    }
  });

  // ── Criar janela principal ─────────────────────────────────────────────────
  createWindow();

  // ── Criar tray icon ────────────────────────────────────────────────────────
  createTray({
    iconPath,
    onShow: showMainWindow,
    onQuit: () => {
      willQuit = true;
      stopAll();
      destroyTray();
      app.quit();
    },
  });

  // macOS: recriar janela ao clicar no dock icon se não houver janelas abertas
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

// Não sair quando todas as janelas fecham — o tray mantém o processo vivo.
// O scheduler do Go API continua a disparar enquanto o processo Electron existir.
app.on("window-all-closed", () => {
  // Intencional: não chama app.quit()
});

// Limpeza antes de sair (qualquer origem: taskbar, tray, sistema, etc.)
app.on("before-quit", () => {
  willQuit = true;
  stopAll();
  destroyTray();
});
