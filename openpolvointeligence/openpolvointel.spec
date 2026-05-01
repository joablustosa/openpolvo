# -*- mode: python ; coding: utf-8 -*-
# PyInstaller injecta Analysis, PYZ, EXE, COLLECT no namespace ao executar este ficheiro.
# Saída: dist/openpolvointel/openpolvointel.exe (onedir; _internal ao lado do .exe)

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

SPEC_ROOT = Path(SPECPATH)
SRC = str(SPEC_ROOT / "src")
PROMPTS_DIR = SPEC_ROOT / "src" / "openpolvointeligence" / "prompts"


def _subs(mod: str) -> list:
    try:
        return collect_submodules(mod)
    except Exception:
        return []


_hidden = []
for pkg in (
    "openpolvointeligence",
    "uvicorn",
    "langgraph",
    "langchain_core",
    "langchain_openai",
    "langchain_google_genai",
    "httpx",
):
    _hidden.extend(_subs(pkg))

hiddenimports = list(dict.fromkeys(_hidden))

block_cipher = None

a = Analysis(
    [str(SPEC_ROOT / "run_intel.py")],
    pathex=[SRC],
    binaries=[],
    datas=[(str(PROMPTS_DIR), "openpolvointeligence/prompts")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="openpolvointel",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="openpolvointel",
)
