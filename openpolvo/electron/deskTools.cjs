/**
 * Desk tools — terminal e git via IPC (M2 TOOL-2 / TOOL-3).
 */

const path = require("path");
const fs = require("fs");
const { execFile, spawn } = require("child_process");

const TERMINAL_TIMEOUT_MS = 60_000;

const TERMINAL_DENY = [
  /\brm\s+-rf\b/i,
  /\bformat\b/i,
  /\bdel\s+\/f/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
];

function safeWorkspaceRoot(workspacePath) {
  const root = path.resolve(String(workspacePath || "").trim());
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("workspace_not_found");
  }
  return root;
}

function terminalDenied(command) {
  const cmd = String(command || "");
  return TERMINAL_DENY.some((re) => re.test(cmd));
}

function runGit(root, args) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.join(root, ".git"))) {
      resolve({ ok: false, error: "not_a_git_repo" });
      return;
    }
    execFile(
      "git",
      args,
      { cwd: root, timeout: 30_000, windowsHide: true, maxBuffer: 512 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || "") + String(stderr || "");
        if (err && !out.trim()) {
          resolve({ ok: false, error: String(err.message || err) });
          return;
        }
        resolve({
          ok: err ? false : true,
          exit_code: err && typeof err.code === "number" ? err.code : 0,
          output: out.trim(),
        });
      },
    );
  });
}

function registerDeskToolsIpc(ipcMain) {
  ipcMain.handle("deskTerminal:run", (_evt, payload) => {
    try {
      const root = safeWorkspaceRoot(payload?.workspacePath);
      const command = String(payload?.command || "").trim();
      if (!command) return { ok: false, error: "empty_command" };
      if (terminalDenied(command)) return { ok: false, error: "command_denied" };
      return new Promise((resolve) => {
        const child = spawn(command, [], {
          shell: true,
          cwd: root,
          windowsHide: true,
        });
        let out = "";
        const feed = (chunk) => {
          out += String(chunk);
        };
        child.stdout?.on("data", feed);
        child.stderr?.on("data", feed);
        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          resolve({ ok: false, error: "timeout", output: out.trim().slice(0, 32_000) });
        }, TERMINAL_TIMEOUT_MS);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            ok: code === 0,
            exit_code: code ?? 0,
            output: out.trim().slice(0, 32_000),
          });
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve({ ok: false, error: String(err?.message ?? err) });
        });
      });
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("deskGit:status", (_evt, payload) => {
    try {
      const root = safeWorkspaceRoot(payload?.workspacePath);
      return runGit(root, ["status", "--short", "--branch"]);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("deskGit:diff", (_evt, payload) => {
    try {
      const root = safeWorkspaceRoot(payload?.workspacePath);
      const rel = String(payload?.relPath || payload?.path || "").trim();
      const args = ["diff", "--stat"];
      if (rel) args.push(rel);
      return runGit(root, args);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("deskGit:commit", (_evt, payload) => {
    try {
      if (process.env.DESK_GIT_ALLOW_COMMIT !== "1" && process.env.DESK_GIT_ALLOW_COMMIT !== "true") {
        return { ok: false, error: "git_commit_disabled" };
      }
      const root = safeWorkspaceRoot(payload?.workspacePath);
      const message = String(payload?.message || "").trim();
      if (!message) return { ok: false, error: "commit_message_required" };
      return runGit(root, ["commit", "-m", message]);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
}

module.exports = { registerDeskToolsIpc };
