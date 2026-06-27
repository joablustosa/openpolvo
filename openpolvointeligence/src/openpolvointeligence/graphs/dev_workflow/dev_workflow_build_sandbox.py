"""Build sandbox real — portão anti-bug que compila o projecto gerado.

Escreve os `project_files` num diretório temporário e corre verificação real
(`npm ci`/`npm install` + `npx tsc --noEmit`, opcionalmente `npx vite build`),
com timeouts. Faz parse dos erros para `[{"file","line","message"}]`.

Degrada graciosamente: se o ambiente não tiver Node/npm (ou o flag estiver
desligado), devolve `ran=False, ok=True` — nunca quebra o pipeline. A camada de
parsing é pura e testável (não depende de subprocessos).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import tempfile
from typing import Any, Literal

from openpolvointeligence.core.config import Settings

_logger = logging.getLogger(__name__)

BuildTool = Literal["tsc", "vite"]

# `file(line,col): error TSxxxx: message` (tsc --pretty false)
_TSC_PAREN_RE = re.compile(
    r"^(?P<file>[^\s(][^(]*?)\((?P<line>\d+),(?P<col>\d+)\):\s+error\s+TS\d+:\s+(?P<msg>.+)$",
)
# `file:line:col - error TSxxxx: message` / vite/esbuild `file:line:col: ERROR: message`
_COLON_RE = re.compile(
    r"^(?P<file>[^\s:][^:]*?):(?P<line>\d+):(?P<col>\d+)\s*[-:]\s*(?:error|ERROR)\b[^:]*:\s*(?P<msg>.+)$",
)


def parse_build_errors(output: str, *, limit: int = 30) -> list[dict[str, Any]]:
    """Extrai erros estruturados `{file, line, message}` do stdout/stderr do build."""
    if not output:
        return []
    errors: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str]] = set()
    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        m = _TSC_PAREN_RE.match(line) or _COLON_RE.match(line)
        if not m:
            continue
        file = m.group("file").strip().replace("\\", "/")
        try:
            line_no = int(m.group("line"))
        except ValueError:
            line_no = 0
        msg = m.group("msg").strip()
        key = (file, line_no, msg)
        if key in seen:
            continue
        seen.add(key)
        errors.append({"file": file, "line": line_no, "message": msg})
        if len(errors) >= limit:
            break
    return errors


def build_disabled_result(tool: BuildTool) -> dict[str, Any]:
    """Resultado de degradação graciosa (build não executado)."""
    return {"ok": True, "ran": False, "tool": tool, "errors": []}


def node_toolchain_available(package_manager: str = "npm") -> bool:
    """True se `node` e o gestor de pacotes estiverem no PATH."""
    return bool(shutil.which("node")) and bool(shutil.which(package_manager))


async def _run(cmd: list[str], cwd: str, timeout_s: float) -> tuple[int, str]:
    """Corre um comando e devolve (returncode, stdout+stderr) com timeout."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "CI": "1", "NO_COLOR": "1"},
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, f"timeout após {timeout_s:.0f}s: {' '.join(cmd)}"
    return proc.returncode or 0, (out or b"").decode("utf-8", errors="replace")


def _write_project(root: str, project_files: dict[str, str]) -> int:
    written = 0
    for raw_path, content in project_files.items():
        path = str(raw_path).strip().replace("\\", "/").lstrip("/")
        if not path or ".." in path.split("/"):
            continue
        dest = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(dest) or root, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(str(content or ""))
        written += 1
    return written


async def run_build_sandbox(
    settings: Settings,
    project_files: dict[str, str],
) -> dict[str, Any]:
    """Compila o projecto num sandbox temporário e devolve o resultado estruturado."""
    tool: BuildTool = (
        "vite" if getattr(settings, "dev_workflow_build_sandbox_tool", "tsc") == "vite" else "tsc"
    )
    if not getattr(settings, "dev_workflow_build_sandbox_enabled", False):
        return build_disabled_result(tool)
    if not isinstance(project_files, dict) or not project_files:
        return build_disabled_result(tool)

    pkg_manager = str(getattr(settings, "dev_workflow_build_sandbox_package_manager", "npm"))
    if not node_toolchain_available(pkg_manager):
        _logger.info("Build sandbox: Node/%s ausente — a degradar (ran=False).", pkg_manager)
        return build_disabled_result(tool)

    install_timeout = float(
        getattr(settings, "dev_workflow_build_sandbox_install_timeout_s", 240.0)
    )
    build_timeout = float(getattr(settings, "dev_workflow_build_sandbox_build_timeout_s", 120.0))

    tmp_root = tempfile.mkdtemp(prefix="op-build-")
    try:
        _write_project(tmp_root, project_files)

        if "package.json" in project_files:
            install_cmd = (
                [pkg_manager, "ci"]
                if os.path.exists(os.path.join(tmp_root, "package-lock.json"))
                else [pkg_manager, "install", "--no-audit", "--no-fund"]
            )
            rc_install, out_install = await _run(install_cmd, tmp_root, install_timeout)
            if rc_install != 0:
                errors = parse_build_errors(out_install) or [
                    {"file": "package.json", "line": 0, "message": out_install.strip()[-400:]},
                ]
                return {"ok": False, "ran": True, "tool": tool, "errors": errors}

        if tool == "vite":
            cmd = [pkg_manager == "npm" and "npx" or pkg_manager, "vite", "build"]
        else:
            cmd = ["npx", "tsc", "--noEmit", "--pretty", "false"]
        rc_build, out_build = await _run(cmd, tmp_root, build_timeout)
        errors = parse_build_errors(out_build)
        ok = rc_build == 0 and not errors
        if not ok and not errors:
            errors = [{"file": "", "line": 0, "message": out_build.strip()[-400:]}]
        return {"ok": ok, "ran": True, "tool": tool, "errors": errors}
    except OSError as exc:
        _logger.warning("Build sandbox falhou (I/O) — a degradar: %s", exc)
        return build_disabled_result(tool)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def build_errors_to_digest(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Converte erros do sandbox para o formato CompileErrorDigest do self-heal."""
    digest: list[dict[str, Any]] = []
    for e in errors[:15]:
        if not isinstance(e, dict):
            continue
        digest.append(
            {
                "path": str(e.get("file") or "") or None,
                "line": int(e.get("line") or 0) or None,
                "column": None,
                "code": "build",
                "message": str(e.get("message") or "")[:400],
            },
        )
    return digest
