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

const isDev = !app.isPackaged;

const CREDS_FILENAME = "openpolvo-saved-login.enc";

function getCredsPath() {
  return path.join(app.getPath("userData"), CREDS_FILENAME);
}

function registerCredentialIpc() {
  ipcMain.handle("credentials:isEncryptionAvailable", () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  });

  ipcMain.handle("credentials:save", (_evt, payload) => {
    try {
      const email = typeof payload?.email === "string" ? payload.email.trim() : "";
      const password = typeof payload?.password === "string" ? payload.password : "";
      if (!email || password.length > 4096) {
        return { ok: false, error: "Dados inválidos." };
      }
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: "Cifra indisponível neste sistema." };
      }
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
      if (!fs.existsSync(p)) {
        return { ok: true, data: null };
      }
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: "Cifra indisponível.", data: null };
      }
      const buf = fs.readFileSync(p);
      const plain = safeStorage.decryptString(buf);
      const data = JSON.parse(plain);
      if (typeof data?.email !== "string" || typeof data?.password !== "string") {
        return { ok: true, data: null };
      }
      return { ok: true, data: { email: data.email.trim(), password: data.password } };
    } catch {
      return { ok: true, data: null };
    }
  });

  ipcMain.handle("credentials:clear", () => {
    try {
      const p = getCredsPath();
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
}

app.setName("Open Polvo");

// Ícone da janela/taskbar. Usa o logo oficial (PNG) para coerência com o branding.
// Em dev resolvemos a partir de src/assets; em produção o mesmo ficheiro vai para
// build/icon.png via scripts de packaging (electron-builder lê automaticamente).
const iconPath = isDev
  ? path.join(__dirname, "..", "src", "assets", "oficial_logo.png")
  : path.join(__dirname, "..", "build", "icon.png");
const appIcon = (() => {
  try {
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
})();

if (appIcon && process.platform === "darwin" && app.dock) {
  try {
    app.dock.setIcon(appIcon);
  } catch {
    // ignora em plataformas que não suportam
  }
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

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  registerCredentialIpc();

  // WebContainers (@webcontainer/api) exige isolamento cross-origin (SharedArrayBuffer).
  // O Vite em dev já envia COOP/COEP; no Electron o loadURL não passa por esses headers,
  // por isso injectamos aqui as mesmas políticas para localhost:5173 em desenvolvimento.
  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ["http://localhost:5173/*", "http://127.0.0.1:5173/*"] },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
        responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
        callback({ responseHeaders });
      },
    );
  }

  // Menus da aplicação são só os componentes Shadcn na UI (estilo Claude), não a barra nativa.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
