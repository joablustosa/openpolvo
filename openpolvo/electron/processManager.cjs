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
const logger = require("./logger.cjs");

const isDev = !app.isPackaged;

// ── Estado interno ─────────────────────────────────────────────────────────────
/** @type {Map<string, import("child_process").ChildProcess>} */
const procs = new Map();

/** @type {Map<string, Array<{ts: number, line: string, isError: boolean}>>} */
const logsByService = new Map();

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

function pushLog(name, line, isError) {
  const t = typeof line === "string" ? line : String(line ?? "");
  if (t.trim() === "") return;
  const arr = logsByService.get(name) ?? [];
  arr.push({ ts: Date.now(), line: t, isError: Boolean(isError) });
  // Mantém apenas os últimos ~400 eventos por serviço (suficiente p/ diagnóstico).
  if (arr.length > 400) arr.splice(0, arr.length - 400);
  logsByService.set(name, arr);

  // Persistência para suporte pós-instalação
  logger.log(name, `${isError ? "stderr" : "stdout"}: ${t}`);
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

/** Defaults para a API Go em instalação empacotada (userData + migrações ao lado do .exe). */
function mergeApiEnv(userEnv) {
  const ud = app.getPath("userData");
  // Caminho absoluto para as migrações — evita dependência do cwd do processo.
  const migrationsAbs = path.join(process.resourcesPath, "backend", "migrations");
  const defaults = {
    HTTP_ADDR: ":8080",
    CORS_ALLOW_NULL_ORIGIN: "true",
    RUN_MIGRATIONS: "true",
    MIGRATIONS_PATH: migrationsAbs,
    DB_PATH: path.join(ud, "openpolvo.db"),
    POLVO_INTELLIGENCE_BASE_URL: "http://127.0.0.1:8090",
  };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(userEnv)) {
    if (v !== undefined && String(v).trim() !== "") merged[k] = String(v).trim();
  }
  if (merged.DB_PATH && !path.isAbsolute(merged.DB_PATH)) {
    merged.DB_PATH = path.resolve(ud, merged.DB_PATH);
  }
  // Garante que MIGRATIONS_PATH é sempre absoluto, mesmo que venha do ficheiro .env.
  if (merged.MIGRATIONS_PATH && !path.isAbsolute(merged.MIGRATIONS_PATH)) {
    merged.MIGRATIONS_PATH = migrationsAbs;
  }
  return merged;
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
    const line = chunk.toString().trimEnd();
    pushLog(name, line, false);
    emit(name, "log", { line, isError: false });
  });

  proc.stderr?.on("data", (chunk) => {
    const line = chunk.toString().trimEnd();
    pushLog(name, line, true);
    emit(name, "log", { line, isError: true });
  });

  proc.on("error", (err) => {
    procs.delete(name);
    pushLog(name, `spawn error: ${err?.message ?? String(err)}`, true);
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
    const envOverrides = mergeApiEnv(userEnv);
    spawnService("api", binPath, envOverrides);
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

/** Reinicia todos os serviços (stop -> start). */
function restartAll() {
  stopAll();
  startAll();
}

function getDiagnostics() {
  const apiLogs = logsByService.get("api") ?? [];
  const intelLogs = logsByService.get("intelligence") ?? [];
  return {
    isDev,
    resourcesPath: process.resourcesPath,
    api: {
      status: isDev ? "external" : (procs.has("api") ? "running" : "stopped"),
      logs: apiLogs.slice(-120),
    },
    intelligence: {
      status: isDev ? "external" : (procs.has("intelligence") ? "running" : "stopped"),
      logs: intelLogs.slice(-120),
    },
  };
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

module.exports = { startAll, stopAll, restartAll, getStatus, getDiagnostics, onStatus };
