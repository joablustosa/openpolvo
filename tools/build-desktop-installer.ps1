#Requires -Version 5.1
<#
.SYNOPSIS
  Gera instalador Windows do Open Polvo com frontend (Electron), backend (Go) e intelligence (Python).

.DESCRIPTION
  1. Compila openlaele-api.exe (Go)
  2. Empacota openpolvointel (PyInstaller onedir)
  3. Compila o polvocode (gulp vscode-win32-x64-min-ci)
  4. Copia binários para resources/openpolvo/
  5. Gera VSCodeSetup.exe (Inno Setup)

.PARAMETER SkipInstaller
  Só produz a pasta VSCode-win32-x64 (sem Inno Setup).

.PARAMETER SkipElectronCompile
  Reutiliza out/ existente (apenas transpile-client). Útil para iterar nos serviços.

.PARAMETER Portable
  Empacota pasta portátil (transpile-client + Electron) sem compile-build nem Inno Setup.
  Use quando compile-build falhar ou para testes rápidos.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build-desktop-installer.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build-desktop-installer.ps1 -Portable
#>
param(
    [switch]$SkipInstaller,
    [switch]$SkipElectronCompile,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = Join-Path $RepoRoot 'dist\desktop'
$BackendDist = Join-Path $DistRoot 'backend'
$IntelDist = Join-Path $DistRoot 'intelligence'
$PolvoCode = Join-Path $RepoRoot 'polvocode'
$Arch = 'x64'

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function New-RandomSecret([int]$bytes = 32) {
    $buf = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return [Convert]::ToBase64String($buf)
}

function Ensure-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Comando '$name' não encontrado. $hint"
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][scriptblock]$Command
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "$Label falhou (exit $LASTEXITCODE)"
        }
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

Write-Step "Pré-requisitos"
Ensure-Command go "Instale Go 1.25+ (https://go.dev/dl/)"
Ensure-Command uv "Instale uv (https://docs.astral.sh/uv/)"
Ensure-Command npm "Instale Node.js 20+ (https://nodejs.org/)"

Write-Step "Limpar dist anterior"
if (Test-Path $DistRoot) { Remove-Item -Recurse -Force $DistRoot }
New-Item -ItemType Directory -Force -Path $BackendDist, $IntelDist | Out-Null

Write-Step "Gerar segredos de runtime (manifest.json)"
$internalKey = New-RandomSecret 24
$jwtSecret = New-RandomSecret 32
$manifest = @{
    version            = '0.1.0'
    backendPort        = 8081
    intelligencePort   = 8090
    jwtSecret          = $jwtSecret
    internalKey        = $internalKey
    defaultAdminEmail  = 'admin@openlaele.local'
    defaultAdminPassword = 'ChangeMeLocalDev_Only'
}
$manifestDir = Join-Path $DistRoot 'openpolvo'
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifest | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $manifestDir 'manifest.json')

Write-Step "Build Backend Go (openlaele-api.exe)"
Push-Location (Join-Path $RepoRoot 'openpolvobackend')
try {
    $env:CGO_ENABLED = '0'
    Invoke-External 'go build' { go build -trimpath -ldflags "-s -w" -o (Join-Path $BackendDist 'openlaele-api.exe') ./cmd/openlaele-api }
    Copy-Item -Recurse -Force (Join-Path $RepoRoot 'openpolvobackend\migrations') (Join-Path $BackendDist 'migrations')
}
finally {
    Pop-Location
}

Write-Step "Build Intelligence Python (PyInstaller)"
Push-Location (Join-Path $RepoRoot 'openpolvointeligence')
try {
    Invoke-External 'uv sync' { uv sync --extra dev }
    Invoke-External 'pyinstaller' {
        uv run pyinstaller openpolvointel.spec --noconfirm `
            --distpath (Join-Path $DistRoot 'pyi-dist') `
            --workpath (Join-Path $DistRoot 'pyi-build')
    }
    $pyiOut = Join-Path $DistRoot 'pyi-dist\openpolvointel'
    if (-not (Test-Path $pyiOut)) {
        throw "PyInstaller não gerou $pyiOut"
    }
    Copy-Item -Recurse -Force "$pyiOut\*" $IntelDist
}
finally {
    Pop-Location
}

Write-Step "Compilar polvocode (Electron)"
$PortableDir = Join-Path $DistRoot 'OpenPolvo-portable'
Push-Location $PolvoCode
try {
    if ($Portable) {
        if (-not (Test-Path 'node_modules')) {
            Invoke-External 'npm ci' { npm ci }
        }
        Invoke-External 'npm electron' { npm run electron }
        & (Join-Path $PolvoCode 'scripts\ensure-codicons.ps1')
        Invoke-External 'npm transpile-client' { npm run transpile-client }
    }
    elseif (-not $SkipElectronCompile) {
        if (-not (Test-Path 'node_modules')) {
            Invoke-External 'npm ci' { npm ci }
        }
        Invoke-External 'npm compile-build' { npm run compile-build }
        Invoke-External 'gulp package' { npm run gulp "vscode-win32-$Arch-min-ci" }
    }
    else {
        Invoke-External 'npm transpile-client' { npm run transpile-client }
        Write-Host "    SkipElectronCompile: a usar out/ existente; execute gulp manualmente se necessário." -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}

if ($Portable) {
    Write-Step "Montar pacote portátil"
    if (Test-Path $PortableDir) { Remove-Item -Recurse -Force $PortableDir }
    New-Item -ItemType Directory -Force -Path $PortableDir | Out-Null

    $electronDir = Join-Path $PolvoCode '.build\electron'
    if (-not (Test-Path $electronDir)) {
        throw "Electron não encontrado em $electronDir (npm run electron falhou?)"
    }
    Copy-Item -Recurse -Force "$electronDir\*" $PortableDir

    $appDir = Join-Path $PortableDir 'resources\app'
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    Copy-Item -Force (Join-Path $PolvoCode 'package.json') $appDir
    Copy-Item -Force (Join-Path $PolvoCode 'product.json') $appDir
    Copy-Item -Recurse -Force (Join-Path $PolvoCode 'out') (Join-Path $appDir 'out')
    if (Test-Path (Join-Path $PolvoCode 'node_modules.asar')) {
        Copy-Item -Force (Join-Path $PolvoCode 'node_modules.asar') $appDir
    }

    $ResourcesOpenPolvo = Join-Path $PortableDir 'resources\openpolvo'
    New-Item -ItemType Directory -Force -Path $ResourcesOpenPolvo | Out-Null
    Copy-Item -Recurse -Force $BackendDist (Join-Path $ResourcesOpenPolvo 'backend')
    Copy-Item -Recurse -Force $IntelDist (Join-Path $ResourcesOpenPolvo 'intelligence')
    Copy-Item -Force (Join-Path $manifestDir 'manifest.json') (Join-Path $ResourcesOpenPolvo 'manifest.json')

    $launcher = @'
@echo off
setlocal
cd /d "%~dp0"
set OPENPOLVO_API_BASE_URL=http://127.0.0.1:8081
set OPENPOLVO_AGENT_ENABLED=true
set OPENPOLVO_DEV_WORKFLOW_ENABLED=true
set OPENPOLVO_LOCAL_EMAIL=admin@openlaele.local
set OPENPOLVO_LOCAL_PASSWORD=ChangeMeLocalDev_Only
start "" "%~dp0Open Polvo.exe" .
endlocal
'@
    Set-Content -Encoding ASCII (Join-Path $PortableDir 'OpenPolvo.bat') $launcher

    Write-Step "Pacote portátil pronto"
    Write-Host "    $PortableDir" -ForegroundColor Green
    Write-Host "    Execute: OpenPolvo.bat ou 'Open Polvo.exe'" -ForegroundColor Green
    exit 0
}

$PackageDir = Join-Path (Split-Path $PolvoCode -Parent) "VSCode-win32-$Arch"
if (-not (Test-Path $PackageDir)) {
    throw "Pasta de empacotamento não encontrada: $PackageDir (gulp vscode-win32-$Arch-min-ci falhou?)"
}

Write-Step "Copiar serviços OpenPolvo para resources/"
$ResourcesOpenPolvo = Join-Path $PackageDir "resources\openpolvo"
if (Test-Path $ResourcesOpenPolvo) { Remove-Item -Recurse -Force $ResourcesOpenPolvo }
New-Item -ItemType Directory -Force -Path $ResourcesOpenPolvo | Out-Null
Copy-Item -Recurse -Force $BackendDist (Join-Path $ResourcesOpenPolvo 'backend')
Copy-Item -Recurse -Force $IntelDist (Join-Path $ResourcesOpenPolvo 'intelligence')
Copy-Item -Force (Join-Path $manifestDir 'manifest.json') (Join-Path $ResourcesOpenPolvo 'manifest.json')

if ($SkipInstaller) {
    Write-Step "Concluído (sem instalador)"
    Write-Host "    Pasta: $PackageDir" -ForegroundColor Green
    Write-Host "    Executável: $(Join-Path $PackageDir 'Open Polvo.exe')" -ForegroundColor Green
    exit 0
}

Write-Step "Gerar instalador Inno Setup"
Push-Location $PolvoCode
try {
    Invoke-External 'gulp inno-updater' { npm run gulp "vscode-win32-$Arch-inno-updater" }
    Invoke-External 'gulp user-setup' { npm run gulp "vscode-win32-$Arch-user-setup" }
}
finally {
    Pop-Location
}

$SetupDir = Join-Path $PolvoCode ".build\win32-$Arch\user-setup"
$SetupExe = Get-ChildItem -Path $SetupDir -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($SetupExe) {
    $dest = Join-Path $DistRoot 'OpenPolvo-UserSetup-x64.exe'
    Copy-Item -Force $SetupExe.FullName $dest
    Write-Step "Instalador pronto"
    Write-Host "    $dest" -ForegroundColor Green
}
else {
    Write-Host "    Aviso: instalador não encontrado em $SetupDir" -ForegroundColor Yellow
    Write-Host "    Pasta portátil disponível em: $PackageDir" -ForegroundColor Yellow
}

Write-Host @"

Credenciais iniciais (primeiro arranque):
  Email:    admin@openlaele.local
  Password: ChangeMeLocalDev_Only

Requisito LLM local: instale Ollama (https://ollama.com/) e execute:
  ollama pull llama3.2

"@ -ForegroundColor DarkGray
