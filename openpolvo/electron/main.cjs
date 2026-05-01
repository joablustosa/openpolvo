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
  dialog,
} = require("electron");
const { shell, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const logger = require("./logger.cjs");

// Windows: alguns drivers/GPU fazem o Chromium sair com ecrã branco ou crash (4294967295).
// PowerShell: $env:OPEN_POLVO_DISABLE_GPU="1"; npm run dev
if (process.platform === "win32" && process.env.OPEN_POLVO_DISABLE_GPU === "1") {
  try {
    app.disableHardwareAcceleration();
  } catch {
    /* ignora */
  }
}

const { createTray, destroyTray, getAutoLaunchEnabled, setAutoLaunch, notifyTray } = require("./tray.cjs");
const { registerPolvoCodeIpc } = require("./polvoCode.cjs");

const isDev = !app.isPackaged;

// ── Desktop (cliente apenas): não gerir serviços locais ────────────────────────
function startAll() { /* noop */ }
function stopAll() { /* noop */ }
function restartAll() { /* noop */ }
function getStatus() { return { api: "external", intelligence: "external" }; }
function getDiagnostics() {
  return {
    isDev,
    resourcesPath: process.resourcesPath,
    api: { status: "external", logs: [] },
    intelligence: { status: "external", logs: [] },
  };
}
function onStatus() { /* noop */ }

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

// ── Primeira execução (instalação empacotada): .env em userData ───────────────
const BACKEND_ENV_NAME = "backend.env";
const INTEL_ENV_NAME = "intelligence.env";

function userDataEnvPaths() {
  const ud = app.getPath("userData");
  return {
    backend: path.join(ud, BACKEND_ENV_NAME),
    intelligence: path.join(ud, INTEL_ENV_NAME),
  };
}

function desktopNeedsFirstRunSetup() {
  return false;
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function writeEnvFile(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Remove a BD SQLite local (e WAL/SHM) para o primeiro arranque alinhar com um
 * novo backend.env (JWT, DEFAULT_ADMIN_PASSWORD, etc.). Sem isto, se o utilizador
 * voltar a correr o assistente mas mantiver openpolvo.db, o bootstrap Go não
 * actualiza a password existente e o login falha com "invalid credentials".
 */
function removeLocalOpenPolvoDatabase(userDataDir) {
  const base = path.join(userDataDir, "openpolvo.db");
  for (const p of [base, `${base}-wal`, `${base}-shm`]) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        logger.log("electron", `removed local db file: ${p}`);
      }
    } catch (e) {
      throw new Error(`Não foi possível remover ${p}: ${String(e?.message ?? e)}`);
    }
  }
}

/** Origem da API para o renderer empacotado (alinha com OPEN_LA_ELE_API_URL após ler userData). */
function getPackagedRendererApiBaseUrl() {
  const u = process.env.OPEN_LA_ELE_API_URL;
  if (typeof u === "string" && u.trim() !== "") return u.trim();
  return "http://127.0.0.1:8081";
}

function parseHttpAddrToOrigin(httpAddr) {
  // Aceita formatos: ":8080", "127.0.0.1:8080", "0.0.0.0:8080", "localhost:8080"
  const raw = String(httpAddr ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(?:(?<host>[^:]+))?:(?<port>\d{2,5})$/);
  if (!m || !m.groups?.port) return null;
  const port = m.groups.port;
  let host = (m.groups.host ?? "").trim();
  if (!host || host === "0.0.0.0" || host === "::") host = "127.0.0.1";
  return `http://${host}:${port}`;
}

function readSimpleEnvFile(filePath) {
  const env = {};
  try {
    if (!fs.existsSync(filePath)) return env;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = String(line).trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch { /* ignora */ }
  return env;
}

function ensureApiBaseUrlEnvFromUserData() {
  if (isDev || !app.isPackaged) return;
  // Não sobrepõe se o utilizador/setador já definiu explicitamente.
  if (typeof process.env.OPEN_LA_ELE_API_URL === "string" && process.env.OPEN_LA_ELE_API_URL.trim() !== "") return;
  try {
    const ud = app.getPath("userData");
    const backendEnvPath = path.join(ud, "backend.env");
    const env = readSimpleEnvFile(backendEnvPath);
    const origin = parseHttpAddrToOrigin(env.HTTP_ADDR) ?? "http://127.0.0.1:8081";
    process.env.OPEN_LA_ELE_API_URL = origin;
  } catch {
    process.env.OPEN_LA_ELE_API_URL = "http://127.0.0.1:8081";
  }
}

function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    try {
      const net = require("net");
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => resolve(false));
      srv.listen({ port, host }, () => {
        try { srv.close(() => resolve(true)); } catch { resolve(true); }
      });
    } catch {
      resolve(false);
    }
  });
}

// ── CSP: preview isolado (scripts só no próprio origin; sem CDNs de terceiros) ──
// Portos alvo: OPEN_POLVO_PREVIEW_CSP_PORTS (ex.: 5175,5180). Defina antes de `electron .`
// se o Vite de preview usar outras portas.

function parsePreviewCspPorts() {
  const raw = process.env.OPEN_POLVO_PREVIEW_CSP_PORTS || "5175,5180,5176,4174";
  const ports = raw
    .split(/[,; \t]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return ports.length ? ports : [5175, 5180, 4174];
}

function previewCspUrlFilterPatterns() {
  const ports = parsePreviewCspPorts();
  const patterns = [];
  for (const p of ports) {
    patterns.push(`http://127.0.0.1:${p}/*`, `http://localhost:${p}/*`);
  }
  return patterns;
}

/** Política aplicada só a respostas HTTP do origin de preview (não à shell em :5174). */
function buildPreviewContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** URL da shell Vite em desenvolvimento (alinhar com vite.config server.port). */
const DEV_VITE_ORIGIN = "http://127.0.0.1:5174";

async function chooseApiOriginAndPersist() {
  if (isDev || !app.isPackaged) return;
  try {
    const ud = app.getPath("userData");
    const backendEnvPath = path.join(ud, "backend.env");
    const env = readSimpleEnvFile(backendEnvPath);

    // Porta desejada vem de HTTP_ADDR (":8080" por default).
    const raw = String(env.HTTP_ADDR ?? ":8081").trim();
    const m = raw.match(/:(\d{2,5})$/);
    const preferredPort = m ? Number(m[1]) : 8081;

    let chosen = preferredPort;
    // Tenta até 20 portas seguintes antes de desistir
    for (let i = 0; i < 20; i++) {
      const p = preferredPort + i;
      // eslint-disable-next-line no-await-in-loop
      const free = await isPortFree(p);
      if (free) { chosen = p; break; }
    }

    // Atualiza env da API e também a origem exposta ao renderer.
    const origin = `http://127.0.0.1:${chosen}`;
    process.env.OPEN_LA_ELE_API_URL = origin;

    // Se a porta mudou, persiste no backend.env para o próximo boot.
    if (chosen !== preferredPort) {
      logger.log("electron", `porta ${preferredPort} ocupada; usando ${chosen}`);
      try {
        const lines = fs.existsSync(backendEnvPath)
          ? fs.readFileSync(backendEnvPath, "utf8").split(/\r?\n/)
          : [];
        const out = [];
        let wrote = false;
        for (const line of lines) {
          if (line.trim().startsWith("HTTP_ADDR=")) {
            out.push(`HTTP_ADDR=:${chosen}`);
            wrote = true;
          } else if (line.trim() !== "") {
            out.push(line);
          }
        }
        if (!wrote) out.push(`HTTP_ADDR=:${chosen}`);
        fs.writeFileSync(backendEnvPath, out.join("\n") + "\n", "utf8");
      } catch (e) {
        logger.log("electron", `falha ao persistir HTTP_ADDR: ${String(e?.message ?? e)}`);
      }
    }
  } catch (e) {
    logger.log("electron", `chooseApiOriginAndPersist error: ${String(e?.message ?? e)}`);
  }
}

/** @type {(() => void) | null} */
let checkForUpdatesHandler = null;

function registerDesktopIpc() {
  ipcMain.handle("app:checkForUpdates", async () => {
    try {
      if (typeof checkForUpdatesHandler === "function") checkForUpdatesHandler();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
}

function setupAutoUpdater() {
  if (isDev || !app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    checkForUpdatesHandler = () => {
      void autoUpdater.checkForUpdates().catch(() => { /* silencioso */ });
    };

    autoUpdater.on("update-available", (info) => {
      const v = info?.version != null ? String(info.version) : "";
      notifyTray("Open Polvo", v ? `Nova versão ${v} — a descarregar…` : "Nova versão — a descarregar…");
    });

    autoUpdater.on("update-downloaded", (info) => {
      const v = info?.version != null ? String(info.version) : "";
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      void dialog
        .showMessageBox(win ?? BrowserWindow.getFocusedWindow() ?? undefined, {
          type: "info",
          buttons: ["Instalar e reiniciar", "Mais tarde"],
          defaultId: 0,
          cancelId: 1,
          title: "Actualização do Open Polvo",
          message: "Uma nova versão foi descarregada.",
          detail: v ? `Versão: ${v}` : undefined,
        })
        .then((r) => {
          if (r.response === 0) autoUpdater.quitAndInstall(false, true);
        });
    });

    autoUpdater.on("error", () => { /* evita crash por rede */ });

    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => { });
    }, 8000);

    const sixHours = 6 * 60 * 60 * 1000;
    setInterval(() => {
      void autoUpdater.checkForUpdates().catch(() => { });
    }, sixHours);
  } catch {
    checkForUpdatesHandler = null;
  }
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
  ipcMain.handle("services:getDiagnostics", () => getDiagnostics());
  ipcMain.handle("services:restartAll", () => {
    restartAll();
    return getStatus();
  });
}

function registerLogsIpc() {
  ipcMain.handle("logs:getPaths", () => {
    try {
      return { ok: true, dir: logger.logsDir(), file: logger.logFilePath() };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("logs:readTail", (_evt, payload) => {
    try {
      const maxBytes = typeof payload?.maxBytes === "number" ? payload.maxBytes : 64_000;
      const text = logger.readTail(maxBytes);
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), text: "" };
    }
  });

  ipcMain.handle("logs:append", (_evt, payload) => {
    try {
      const scope = typeof payload?.scope === "string" ? payload.scope : "renderer";
      const message = typeof payload?.message === "string" ? payload.message : JSON.stringify(payload ?? {});
      logger.log(scope, message);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("logs:openFolder", async () => {
    try {
      const dir = logger.logsDir();
      await shell.openPath(dir);
      return { ok: true, dir };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("logs:revealFile", async () => {
    try {
      const file = logger.logFilePath();
      shell.showItemInFolder(file);
      return { ok: true, file };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("clipboard:writeText", (_evt, payload) => {
    try {
      const text = typeof payload?.text === "string" ? payload.text : "";
      clipboard.writeText(text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
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
      additionalArguments:
        !isDev && app.isPackaged
          ? [
              `--open-polvo-api-base=${encodeURIComponent(getPackagedRendererApiBaseUrl())}`,
            ]
          : [],
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    // Assistente de primeira execução: sempre mostrar para o utilizador configurar chaves/SMTP.
    if (desktopNeedsFirstRunSetup()) {
      win.maximize();
      win.show();
      return;
    }
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
    const primary = process.env.VITE_DEV_SERVER_URL?.trim() || DEV_VITE_ORIGIN;
    /** Em alguns PCs Windows o stack IPv4/IPv6 diverge; tenta localhost depois de 127.0.0.1. */
    const devUrls = Array.from(
      new Set([primary, DEV_VITE_ORIGIN, "http://localhost:5174"].filter((u) => typeof u === "string" && u !== "")),
    );
    win.webContents.on("did-fail-load", (_e, code, desc, failedUrl) => {
      logger.log("electron", `did-fail-load code=${code} desc=${desc} url=${failedUrl}`);
    });
    void (async () => {
      let lastErr = null;
      for (const devUrl of devUrls) {
        try {
          await win.loadURL(devUrl);
          logger.log("electron", `dev shell loaded ${devUrl}`);
          return;
        } catch (err) {
          lastErr = err;
          logger.log("electron", `loadURL ${devUrl} failed: ${String(err?.message ?? err)}`);
        }
      }
      logger.log("electron", `dev shell: todas as URLs falharam: ${String(lastErr?.message ?? lastErr)}`);
    })();
    /*
     * Não abrir DevTools por defeito: com `openDevTools`, o Chromium corre o UI do
     * DevTools e tenta CDP (`Autofill.enable`, `Autofill.setAddresses`, …) que este
     * runtime nem sempre implementa — isso só polui o terminal (não é falha da app).
     *
     * Para abrir ao arrancar: OPEN_POLVO_DEVTOOLS=1 (PowerShell: $env:OPEN_POLVO_DEVTOOLS=1)
     * Em runtime: F12 ou Ctrl+Shift+I (Cmd+Alt+I no macOS).
     */
    const autoOpenDt =
      process.env.OPEN_POLVO_DEVTOOLS === "1" || process.env.OPEN_DEVTOOLS === "1";
    if (autoOpenDt) {
      win.webContents.openDevTools({ mode: "detach" });
    }
    const isMac = process.platform === "darwin";
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown") return;
      const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
      const wantsDevTools =
        input.key === "F12" ||
        ((isMac ? input.meta : input.control) && input.shift && key === "i");
      if (!wantsDevTools) return;
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: "detach" });
      }
    });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
if (process.platform === "win32") {
  try {
    app.setAppUserModelId("com.openpolvo.app");
  } catch { /* ignora */ }
}

app.whenReady().then(async () => {
  // Garante que o renderer sempre conhece a porta real da API no desktop empacotado.
  // (evita VITE_API_BASE_URL apontar para outra porta, ex.: 8081 em dev).
  ensureApiBaseUrlEnvFromUserData();
  await chooseApiOriginAndPersist();

  logger.log("electron", `app ready (packaged=${app.isPackaged})`);
  logger.log("electron", `userData=${app.getPath("userData")}`);
  logger.log("electron", `resourcesPath=${process.resourcesPath}`);

  registerCredentialIpc();
  registerAppIpc();
  registerLogsIpc();
  registerDesktopIpc();
  registerPolvoCodeIpc(() => mainWindow);
  setupAutoUpdater();

  // CSP estrita só nas origens de preview (iframe / portas dedicadas).
  // A shell Vite em :5174 NÃO é alterada aqui: o próprio Vite envia COOP+COEP+CORP
  // (vite.config.ts). Duplicar COOP/COEP no Electron quebrava HMR / assets → ecrã branco.
  {
    const previewPatterns = previewCspUrlFilterPatterns();
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: previewPatterns },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        responseHeaders["Content-Security-Policy"] = [buildPreviewContentSecurityPolicy()];
        callback({ responseHeaders });
      },
    );
    logger.log(
      "electron",
      `preview CSP active for ports: ${parsePreviewCspPorts().join(", ")}`,
    );
  }

  // Remove menu nativo — a UI usa componentes Shadcn (estilo Claude)
  Menu.setApplicationMenu(null);

  // ── Arrancar serviços backend ──────────────────────────────────────────────
  // Em dev reporta "external"; em prod arranca os binários compilados.
  // Sem ficheiros .env na primeira instalação empacotada, o assistente corre antes.
  if (!desktopNeedsFirstRunSetup()) {
    startAll();
  }

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
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const menuExtras = [];
  if (app.isPackaged && typeof checkForUpdatesHandler === "function") {
    menuExtras.push({
      label: "Verificar actualizações…",
      click: () => {
        if (typeof checkForUpdatesHandler === "function") checkForUpdatesHandler();
      },
    });
  }

  createTray({
    iconPath,
    onShow: showMainWindow,
    onQuit: () => {
      willQuit = true;
      stopAll();
      destroyTray();
      app.quit();
    },
    menuExtras,
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
