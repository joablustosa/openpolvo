/**
 * Gestão de processos filhos: Go API + Python Intelligence.
 *
 * Em modo dev (!app.isPackaged) os serviços são assumidos como externos
 * (iniciados pelo restart-local.ps1), pelo que não são arrancados aqui.
 *
 * Em produção (app.isPackaged) os binários compilados são arrancados a partir
 * de resources/ (configurado no electron-builder via extraResources):
 *
 *   resources/backend/openlaele-api[.exe]
 *   resources/intelligence/openpolvointel[.exe]
 *
 * Configuração por ficheiro .env no userData do utilizador:
 *   %APPDATA%/Open Polvo/backend.env       → HTTP_ADDR, DB_*, POLVO_*, SCHED_*
 *   %APPDATA%/Open Polvo/intelligence.env  → PORT, OPENAI_API_KEY, …
 *
 * Comportamento:
 *  - Restart automático em caso de crash (backoff exponencial: 1s → 2s → 4s … 30s máx)
 *  - Shutdown limpo via SIGTERM ao sair da app
 *  - Eventos de estado emitidos para listeners registados (usados pelo tray + IPC)
 */

const { app } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;

// ── Estado interno ─────────────────────────────────────────────────────────────
/** @type {Map<string, import("child_process").ChildProcess>} */
const procs = new Map();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const restartTimers = new Map();

/** @type {Map<string, number>} backoff em ms por serviço */
const backoffByService = new Map();

/** @type {Array<(event: {name: string, status: string, [k: string]: unknown}) => void>} */
let listeners = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

function emit(name, status, extra = {}) {
  for (const l of listeners) {
    try { l({ name, status, ...extra }); } catch { /* silencia erros no listener */ }
  }
}

function resourcePath(...segments) {
  return path.join(process.resourcesPath, ...segments);
}

/**
 * Lê um ficheiro .env simples (chave=valor) e retorna um objecto de variáveis.
 * Linhas em branco e comentários (#) são ignorados.
 */
function readEnvFile(envFilePath) {
  const env = {};
  if (!fs.existsSync(envFilePath)) return env;
  try {
    for (const line of fs.readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch { /* ignora ficheiro ilegível */ }
  return env;
}

// ── Arrancar processo ──────────────────────────────────────────────────────────

/**
 * @param {string} name        identificador ("api" | "intelligence")
 * @param {string} binPath     caminho absoluto para o binário
 * @param {Record<string,string>} envOverrides  variáveis adicionais (do .env do utilizador)
 */
function spawnService(name, binPath, envOverrides) {
  if (procs.has(name)) return; // já em execução

  emit(name, "starting");

  const proc = spawn(binPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: path.dirname(binPath),
    env: { ...process.env, ...envOverrides },
  });

  procs.set(name, proc);

  proc.on("spawn", () => {
    backoffByService.set(name, 1000); // reset backoff ao arrancar com sucesso
    emit(name, "running");
  });

  proc.stdout?.on("data", (chunk) => {
    emit(name, "log", { line: chunk.toString().trimEnd(), isError: false });
  });

  proc.stderr?.on("data", (chunk) => {
    emit(name, "log", { line: chunk.toString().trimEnd(), isError: true });
  });

  proc.on("error", (err) => {
    procs.delete(name);
    emit(name, "error", { message: err.message });
    scheduleRestart(name);
  });

  proc.on("exit", (code, signal) => {
    procs.delete(name);
    if (signal === "SIGTERM" || signal === "SIGKILL" || code === 0) {
      emit(name, "stopped");
      return;
    }
    emit(name, "crashed", { code });
    scheduleRestart(name);
  });
}

/** Agenda um restart com backoff exponencial (1s → 2s → 4s … máx 30s). */
function scheduleRestart(name) {
  if (restartTimers.has(name)) return;
  const delay = Math.min(backoffByService.get(name) ?? 1000, 30_000);
  backoffByService.set(name, delay * 2);
  emit(name, "restarting", { delayMs: delay });
  const t = setTimeout(() => {
    restartTimers.delete(name);
    if (!procs.has(name)) startService(name);
  }, delay);
  restartTimers.set(name, t);
}

/** Determina o caminho do binário e arranca o serviço. */
function startService(name) {
  if (isDev) {
    // Em dev os serviços são externos — apenas sinaliza para a UI
    emit(name, "external");
    return;
  }

  const ext = process.platform === "win32" ? ".exe" : "";

  if (name === "api") {
    const binPath = resourcePath("backend", `openlaele-api${ext}`);
    if (!fs.existsSync(binPath)) {
      emit(name, "missing", { path: binPath });
      return;
    }
    const userEnv = readEnvFile(path.join(app.getPath("userData"), "backend.env"));
    spawnService("api", binPath, userEnv);
  } else if (name === "intelligence") {
    const binPath = resourcePath("intelligence", `openpolvointel${ext}`);
    if (!fs.existsSync(binPath)) {
      emit(name, "missing", { path: binPath });
      return;
    }
    const userEnv = readEnvFile(path.join(app.getPath("userData"), "intelligence.env"));
    spawnService("intelligence", binPath, userEnv);
  }
}

// ── API pública ────────────────────────────────────────────────────────────────

/** Arranca todos os serviços. */
function startAll() {
  startService("api");
  startService("intelligence");
}

/** Para todos os serviços e cancela restarts pendentes. */
function stopAll() {
  for (const [, t] of restartTimers) clearTimeout(t);
  restartTimers.clear();
  for (const [name, proc] of procs) {
    try { if (!proc.killed) proc.kill("SIGTERM"); } catch { /* ignora */ }
    procs.delete(name);
  }
}

/**
 * Retorna o estado actual de cada serviço.
 * @returns {{ api: string, intelligence: string }}
 */
function getStatus() {
  if (isDev) return { api: "external", intelligence: "external" };
  return {
    api: procs.has("api") ? "running" : "stopped",
    intelligence: procs.has("intelligence") ? "running" : "stopped",
  };
}

/**
 * Regista um listener para eventos de estado dos serviços.
 * @param {(event: {name: string, status: string}) => void} callback
 * @returns {() => void} função para remover o listener
 */
function onStatus(callback) {
  listeners.push(callback);
  return () => { listeners = listeners.filter((l) => l !== callback); };
}

module.exports = { startAll, stopAll, getStatus, onStatus };
