/**
 * Ícone na bandeja do sistema (System Tray).
 *
 * Comportamento:
 *  - Windows/Linux: clique simples → mostra janela; menu de contexto com botão direito
 *  - macOS: menu de contexto no clique; sem dock icon quando janela fechada
 *  - "Iniciar com o Windows" → toggle via app.setLoginItemSettings (openAsHidden: true)
 *  - "Sair" → callback onQuit (para serviços + app.quit)
 *
 * Uso:
 *   const { createTray, destroyTray } = require("./tray.cjs");
 *   createTray({ iconPath, onQuit: () => {...}, onShow: () => {...} });
 */

const { Tray, Menu, nativeImage, app } = require("electron");

/** @type {Tray | null} */
let tray = null;
let _onQuit = () => {};
let _onShow = () => {};

// ── Auto-launch ────────────────────────────────────────────────────────────────

function getAutoLaunchEnabled() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return false;
  }
}

function setAutoLaunch(enabled) {
  try {
    if (enabled) {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true, // arranca minimizado na tray sem mostrar janela
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: false });
    }
  } catch { /* ignora em plataformas sem suporte */ }
}

// ── Menu ───────────────────────────────────────────────────────────────────────

function buildMenu() {
  const autoLaunch = getAutoLaunchEnabled();
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const items = [
    {
      label: "Abrir Open Polvo",
      click: () => _onShow(),
    },
    { type: "separator" },
    {
      label: process.platform === "darwin" ? "Iniciar ao arrancar o Mac" : "Iniciar com o Windows",
      type: "checkbox",
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked);
        // Recria o menu para reflectir o estado
        if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu());
      },
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => _onQuit(),
    },
  ];
  return Menu.buildFromTemplate(items);
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Cria o tray icon. Deve ser chamado uma vez após app.whenReady().
 *
 * @param {object}   opts
 * @param {string}   opts.iconPath  Caminho absoluto para o PNG do ícone
 * @param {() => void} opts.onQuit  Chamado quando o utilizador clica em "Sair"
 * @param {() => void} opts.onShow  Chamado para mostrar/focar a janela principal
 */
function createTray({ iconPath, onQuit, onShow }) {
  _onQuit = onQuit;
  _onShow = onShow;

  let icon;
  try {
    const raw = nativeImage.createFromPath(iconPath);
    if (!raw.isEmpty()) {
      // Tamanho padrão: 16×16 em Windows/Linux; 22×22 em macOS (Retina usa @2x auto)
      const size = process.platform === "darwin" ? 22 : 16;
      icon = raw.resize({ width: size, height: size, quality: "better" });
      // Template image adapta automaticamente ao dark/light mode no macOS
      if (process.platform === "darwin") icon.setTemplateImage(true);
    }
  } catch { /* ícone inválido — usa empty */ }

  tray = new Tray(icon ?? nativeImage.createEmpty());
  tray.setToolTip("Open Polvo — Agente em execução");
  tray.setContextMenu(buildMenu());

  // Clique duplo → mostrar janela (Windows e Linux)
  tray.on("double-click", () => _onShow());

  // No Windows, clique simples também mostra (comportamento esperado)
  if (process.platform === "win32") {
    tray.on("click", () => _onShow());
  }

  return tray;
}

/** Destrói o tray icon (chamado antes de app.quit()). */
function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Mostra uma notificação balloon no tray (Windows) ou nativa (macOS/Linux).
 * Usa a API Electron Notification para compatibilidade cross-platform.
 *
 * @param {string} title
 * @param {string} body
 */
function notifyTray(title, body) {
  try {
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: true });
    n.on("click", () => _onShow());
    n.show();
  } catch { /* ignora em plataformas sem suporte */ }
}

module.exports = { createTray, destroyTray, notifyTray, getAutoLaunchEnabled, setAutoLaunch };
