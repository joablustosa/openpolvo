"""Detecção do ambiente Node local do workspace (sem tocar na rede)."""

from __future__ import annotations

from pathlib import Path


def has_node_modules(workspace_path: str) -> bool:
    return bool(workspace_path) and (Path(workspace_path) / "node_modules").is_dir()


def has_local_package(workspace_path: str, package: str) -> bool:
    """True se o pacote está instalado em node_modules do workspace.

    Usado para decidir se `npx --no-install <bin>` pode correr. Sem esta guarda,
    `npx tsc`/`npx eslint` sem node_modules tenta descarregar pacotes da rede —
    minutos de espera (ou bloqueio) dentro do workflow.
    """
    if not workspace_path:
        return False
    root = Path(workspace_path) / "node_modules"
    if (root / package / "package.json").is_file():
        return True
    bin_dir = root / ".bin"
    return any(
        (bin_dir / name).exists()
        for name in (package, f"{package}.cmd", f"{package}.CMD", f"{package}.ps1")
    )
