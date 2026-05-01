# Compila artefactos Windows para o instalador Electron (API Go + migrações + Intelligence PyInstaller).
# Executar: powershell -File openpolvo/build-desktop-artifacts.ps1 (a partir da raiz do repo ou de openpolvo)
# Requisitos: Go 1.25+, Python 3.11+ com pip.

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Backend = Join-Path $Root "openpolvobackend"
$Intel = Join-Path $Root "openpolvointeligence"
$OutDir = Join-Path $Backend "build\backend"

# Permite o caller fixar um Python específico (ex.: venv) via variável de ambiente.
$Py = $env:PYTHON
if (-not $Py) { $Py = "python" }

Write-Host "==> Go: openlaele-api.exe (windows/amd64, CGO_ENABLED=0)"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Push-Location $Backend
try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "0"
    $exeOut = Join-Path $OutDir "openlaele-api.exe"
    go build -trimpath -ldflags="-s -w" -o $exeOut ./cmd/openlaele-api
    if (-not (Test-Path $exeOut)) { throw "go build não produziu $exeOut" }
}
finally {
    Pop-Location
    Remove-Item Env:GOOS -ErrorAction SilentlyContinue
    Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
    Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
}

Write-Host "==> Copiar migrations -> $OutDir\migrations"
$migSrc = Join-Path $Backend "migrations"
$migDst = Join-Path $OutDir "migrations"
if (Test-Path $migDst) { Remove-Item -Recurse -Force $migDst }
New-Item -ItemType Directory -Force -Path $migDst | Out-Null
Copy-Item -Path (Join-Path $migSrc "*") -Destination $migDst -Recurse -Force

Write-Host "==> PyInstaller: openpolvointel (onedir)"
Push-Location $Intel
try {
    & $Py -m pip install -q -e ".[dev]"
    & $Py -m pip install -q "pyinstaller>=6.0"
    if (Test-Path "dist\openpolvointel") { Remove-Item -Recurse -Force "dist\openpolvointel" }
    & $Py -m PyInstaller --noconfirm openpolvointel.spec
    $intelExe = Join-Path $Intel "dist\openpolvointel\openpolvointel.exe"
    if (-not (Test-Path $intelExe)) { throw "PyInstaller não produziu $intelExe" }
}
finally {
    Pop-Location
}

Write-Host "==> Copy icon to build/icon.png (Electron runtime)"
$BuildDir = Join-Path $PSScriptRoot "build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
$IconSrc = Join-Path $PSScriptRoot "src\assets\oficial_logo.png"
$IconDst = Join-Path $BuildDir "icon.png"
if (Test-Path $IconSrc) {
    Copy-Item -Path $IconSrc -Destination $IconDst -Force
} else {
    Write-Warning "Icon not found at $IconSrc - tray/window will use default icon."
}

Write-Host "Done. Next: npm run dist:win (from openpolvo folder)"
