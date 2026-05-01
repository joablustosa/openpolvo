const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch { /* ignore */ }
}

function logsDir() {
  const ud = app.getPath("userData");
  const d = path.join(ud, "logs");
  ensureDir(d);
  return d;
}

function logFilePath() {
  // Um único arquivo para facilitar suporte.
  return path.join(logsDir(), "openpolvo.log.txt");
}

function stamp(ts = Date.now()) {
  try { return new Date(ts).toISOString(); } catch { return String(ts); }
}

function appendLine(line) {
  try {
    fs.appendFileSync(logFilePath(), `${line}\n`, "utf8");
  } catch {
    // ignore
  }
}

function log(scope, message) {
  const msg = String(message ?? "");
  appendLine(`[${stamp()}] [${scope}] ${msg}`);
}

function readTail(maxBytes = 64_000) {
  const p = logFilePath();
  try {
    if (!fs.existsSync(p)) return "";
    const st = fs.statSync(p);
    const size = st.size || 0;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

module.exports = { logFilePath, logsDir, log, readTail };

