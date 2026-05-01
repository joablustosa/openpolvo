/**
 * Polvo Code — workspace em disco, npm/vite no processo principal, eventos para o renderer.
 * Segurança: caminhos relativos sem `..`; tudo confinado ao directório do projecto.
 */

const { app, ipcMain, dialog } = require("electron");
const { shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { execFile } = require("child_process");

/** @type {import('child_process').ChildProcess | null} */
let devProcess = null;
/** @type {string} */
let devLogBuffer = "";

/**
 * @param {string} s
 */
function slugify(s) {
  return String(s || "project")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

/**
 * Junta root + relativo sem permitir path traversal.
 * @param {string} root
 * @param {string} relPath
 */
function safePathUnderRoot(root, relPath) {
  const raw = String(relPath || "").replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  let cur = path.resolve(root);
  for (const p of parts) {
    if (p === "..") throw new Error("path_traversal");
    cur = path.join(cur, p);
  }
  const rootResolved = path.resolve(root);
  const norm = path.normalize(cur);
  if (!norm.startsWith(rootResolved + path.sep) && norm !== rootResolved) {
    throw new Error("path_escape");
  }
  return norm;
}

/**
 * @param {(payload: Record<string, unknown>) => void} emit
 */
function attachDevStreams(child, emit) {
  devLogBuffer = "";
  const feed = (chunk) => {
    const text = String(chunk);
    devLogBuffer = (devLogBuffer + text).slice(-128_000);
    emit({ type: "log", line: text });
    tryDetectDevUrl(text, emit);
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
  child.on("close", (code) => {
    emit({ type: "exit", code: code ?? null, phase: "dev" });
    devProcess = null;
  });
  child.on("error", (err) => {
    emit({ type: "log", line: `Erro do processo: ${String(err?.message ?? err)}\n` });
    devProcess = null;
  });
}

/**
 * Apenas logs (npm install) — não altera `devProcess` nem buffer de URL.
 * @param {(payload: Record<string, unknown>) => void} emit
 */
function attachInstallStreams(child, emit) {
  const feed = (chunk) => {
    emit({ type: "log", line: String(chunk) });
  };
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
}

/** @param {(payload: Record<string, unknown>) => void} emit */
function tryDetectDevUrl(text, emit) {
  const patterns = [
    /Local:\s*(https?:\/\/[^\s\]]+)/i,
    /Network:\s*(https?:\/\/[^\s\]]+)/i,
    /(https?:\/\/127\.0\.0\.1:\d+\/?)/,
    /(https?:\/\/localhost:\d+\/?)/,
  ];
  for (const re of patterns) {
    const m = devLogBuffer.match(re) || text.match(re);
    if (m && m[1]) {
      let url = m[1].trim();
      if (url.endsWith("/")) url = url.slice(0, -1);
      emit({ type: "url", url });
      return;
    }
  }
}

function killDevProcess() {
  if (!devProcess) return;
  try {
    devProcess.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  devProcess = null;
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

const MAX_READ_BYTES = 2 * 1024 * 1024;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

/**
 * Normaliza segmentos relativos para uso em safePathUnderRoot ("src/foo").
 * @param {string} raw
 */
function normalizeRelPath(raw) {
  const s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) return "";
  return s.replace(/^\/+/, "");
}

/**
 * @param {string} workspacePath
 * @param {string} relPath
 */
function validateWorkspace(workspacePath, relPath) {
  const root = typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "workspace inválido." };
  }
  try {
    const norm = normalizeRelPath(relPath);
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return { ok: false, error: "workspace não é pasta." };
    const absDir = norm === "" ? root : safePathUnderRoot(root, norm);
    return { ok: true, root, absDir, norm };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * @param {string} workspacePath
 * @param {string} relPath ficheiro relativo ao workspace
 */
function validateFilePath(workspacePath, relPath) {
  const root = typeof workspacePath === "string" ? workspacePath.trim() : "";
  const norm = normalizeRelPath(relPath);
  if (!norm) return { ok: false, error: "relPath obrigatório." };
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "workspace inválido." };
  }
  try {
    const absFile = safePathUnderRoot(root, norm);
    return { ok: true, root, absFile, norm };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function registerPolvoCodeIpc(getMainWindow) {
  /**
   * @param {Record<string, unknown>} payload
   */
  function emit(payload) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("polvoCode:event", payload);
    }
  }

  ipcMain.handle("polvoCode:writeProject", (_evt, payload) => {
    try {
      const title = typeof payload?.title === "string" ? payload.title : "project";
      const files = Array.isArray(payload?.files) ? payload.files : [];
      if (files.length === 0) return { ok: false, error: "Sem ficheiros." };

      const projectsRoot = path.join(app.getPath("userData"), "polvo-code-projects");
      fs.mkdirSync(projectsRoot, { recursive: true });
      const dirName = `${slugify(title)}-${Date.now().toString(36)}`;
      const workspacePath = path.join(projectsRoot, dirName);
      fs.mkdirSync(workspacePath, { recursive: true });

      for (const raw of files) {
        const rel =
          typeof raw?.path === "string"
            ? raw.path
            : typeof raw?.Path === "string"
              ? raw.Path
              : "";
        const content =
          typeof raw?.content === "string"
            ? raw.content
            : typeof raw?.Content === "string"
              ? raw.Content
              : "";
        if (!rel.trim()) continue;
        const dest = safePathUnderRoot(workspacePath, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, "utf8");
      }

      return { ok: true, workspacePath };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:listDir", (_evt, payload) => {
    try {
      const workspacePath =
        typeof payload?.workspacePath === "string" ? payload.workspacePath.trim() : "";
      const relPath = normalizeRelPath(
        typeof payload?.relPath === "string" ? payload.relPath : "",
      );
      const v = validateWorkspace(workspacePath, relPath);
      if (!v.ok || !v.absDir) return { ok: false, error: v.error ?? "inválido." };
      if (!fs.existsSync(v.absDir)) return { ok: false, error: "Pasta inexistente." };
      const st = fs.statSync(v.absDir);
      if (!st.isDirectory()) return { ok: false, error: "Não é pasta." };

      let dirents;
      try {
        dirents = fs.readdirSync(v.absDir, { withFileTypes: true });
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }

      /** @type {{ name: string; relPath: string; isDirectory: boolean }[]} */
      const entries = [];
      for (const d of dirents) {
        const name = d.name;
        if (name === "." || name === "..") continue;
        if (d.isDirectory() && SKIP_DIR_NAMES.has(name)) continue;
        const childRel =
          relPath === "" ? name : `${relPath.replace(/\/$/, "")}/${name}`;
        entries.push({
          name,
          relPath: childRel,
          isDirectory: d.isDirectory(),
        });
      }
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      return { ok: true, entries };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:readFile", (_evt, payload) => {
    try {
      const workspacePath =
        typeof payload?.workspacePath === "string" ? payload.workspacePath.trim() : "";
      const relPath = typeof payload?.relPath === "string" ? payload.relPath : "";
      const v = validateFilePath(workspacePath, relPath);
      if (!v.ok || !v.absFile) return { ok: false, error: v.error ?? "inválido." };
      if (!fs.existsSync(v.absFile)) return { ok: false, error: "Ficheiro inexistente." };
      const stat = fs.statSync(v.absFile);
      if (!stat.isFile()) return { ok: false, error: "Não é ficheiro." };
      if (stat.size > MAX_READ_BYTES) {
        return {
          ok: false,
          error: `Ficheiro > ${Math.floor(MAX_READ_BYTES / (1024 * 1024))} MB.`,
        };
      }
      const content = fs.readFileSync(v.absFile, "utf8");
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:writeFile", (_evt, payload) => {
    try {
      const workspacePath =
        typeof payload?.workspacePath === "string" ? payload.workspacePath.trim() : "";
      const relPath = typeof payload?.relPath === "string" ? payload.relPath : "";
      const content = typeof payload?.content === "string" ? payload.content : "";
      const createDirs = Boolean(payload?.createDirs);
      const v = validateFilePath(workspacePath, relPath);
      if (!v.ok || !v.absFile) return { ok: false, error: v.error ?? "inválido." };
      if (createDirs) {
        fs.mkdirSync(path.dirname(v.absFile), { recursive: true });
      }
      fs.writeFileSync(v.absFile, content, "utf8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:chooseProjectFolder", async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win ?? undefined, {
      properties: ["openDirectory", "createDirectory"],
      title: "Escolher pasta do projecto",
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
    return { ok: true, workspacePath: res.filePaths[0] };
  });

  ipcMain.handle("polvoCode:npmInstall", (_evt, payload) => {
    return new Promise((resolve) => {
      const workspacePath =
        typeof payload?.workspacePath === "string" ? payload.workspacePath.trim() : "";
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        resolve({ ok: false, error: "Caminho inválido." });
        return;
      }
      const npm = npmCmd();
      const child = spawn(npm, ["install"], {
        cwd: workspacePath,
        shell: false,
        env: { ...process.env, CI: "1", npm_config_yes: "true" },
      });
      emit({ type: "log", line: `[Polvo Code] npm install em ${workspacePath}\n` });
      attachInstallStreams(child, emit);
      child.on("close", (code) => {
        emit({ type: "exit", code: code ?? null, phase: "install" });
        resolve({
          ok: code === 0,
          code: code ?? null,
          error: code === 0 ? undefined : `npm install terminou com código ${code}`,
        });
      });
      child.on("error", (err) => {
        emit({ type: "log", line: `Erro npm install: ${String(err?.message ?? err)}\n` });
        resolve({ ok: false, error: String(err?.message ?? err) });
      });
    });
  });

  ipcMain.handle("polvoCode:devStart", (_evt, payload) => {
    try {
      killDevProcess();
      const workspacePath =
        typeof payload?.workspacePath === "string" ? payload.workspacePath.trim() : "";
      const port =
        typeof payload?.port === "number" && payload.port > 0 ? Math.floor(payload.port) : 5175;
      const openBrowser = Boolean(payload?.openBrowser);
      if (!workspacePath || !fs.existsSync(workspacePath)) {
        return { ok: false, error: "Caminho inválido." };
      }

      const npm = npmCmd();
      const args = ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)];
      const child = spawn(npm, args, {
        cwd: workspacePath,
        shell: false,
        env: {
          ...process.env,
          BROWSER: "none",
          OPEN: "",
        },
      });
      devProcess = child;

      let sawUrl = false;
      attachDevStreams(child, (ev) => {
        emit(ev);
        if (openBrowser && ev.type === "url" && ev.url && !sawUrl) {
          sawUrl = true;
          try {
            void shell.openExternal(String(ev.url));
          } catch {
            /* ignore */
          }
        }
      });

      emit({ type: "log", line: `[Polvo Code] npm run dev (${workspacePath})\n` });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:devStop", () => {
    killDevProcess();
    emit({ type: "log", line: "[Polvo Code] Servidor dev parado.\n" });
    return { ok: true };
  });

  ipcMain.handle("polvoCode:openExternal", async (_evt, payload) => {
    const url = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "URL inválido." };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:revealInExplorer", (_evt, payload) => {
    const p = typeof payload?.path === "string" ? payload.path.trim() : "";
    if (!p || !fs.existsSync(p)) return { ok: false, error: "Caminho inválido." };
    try {
      shell.showItemInFolder(path.resolve(p));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("polvoCode:tryOpenExternalEditor", (_evt, payload) => {
    const workspacePath =
      typeof payload?.workspacePath === "string"
        ? payload.workspacePath.trim()
        : typeof payload?.path === "string"
          ? payload.path.trim()
          : "";
    const target = workspacePath;
    if (!target || !fs.existsSync(target)) return { ok: false, error: "Caminho inválido." };

    const tryArgs = [];
    if (process.platform === "win32") {
      tryArgs.push(
        { cmd: "cursor.cmd", args: [target] },
        { cmd: "code.cmd", args: [target] },
      );
    } else if (process.platform === "darwin") {
      tryArgs.push(
        { cmd: "cursor", args: [target] },
        { cmd: "code", args: [target] },
        { cmd: "open", args: ["-a", "Cursor", target] },
        { cmd: "open", args: ["-a", "Visual Studio Code", target] },
      );
    } else {
      tryArgs.push({ cmd: "cursor", args: [target] }, { cmd: "code", args: [target] });
    }

    return new Promise((resolve) => {
      let i = 0;
      function next() {
        if (i >= tryArgs.length) {
          resolve({
            ok: false,
            error:
              "Não foi encontrado Cursor nem VS Code no PATH. Abre a pasta manualmente ou define POLVO_CODE_EDITOR.",
          });
          return;
        }
        const { cmd, args } = tryArgs[i++];
        execFile(cmd, args, { windowsHide: true }, (err) => {
          if (!err) resolve({ ok: true, command: cmd });
          else next();
        });
      }
      const override = process.env.POLVO_CODE_EDITOR;
      if (override && override.trim()) {
        const parts = override.trim().split(/\s+/);
        const exe = parts[0];
        const rest = parts.slice(1).concat(target);
        execFile(exe, rest, { windowsHide: true }, (err) => {
          if (!err) resolve({ ok: true, command: exe });
          else next();
        });
      } else {
        next();
      }
    });
  });

  app.on("before-quit", () => {
    killDevProcess();
  });
}

module.exports = { registerPolvoCodeIpc };
