param(
    [switch]$Install,
    [switch]$SkipBuild,
    [switch]$VerboseLogs
)

$ErrorActionPreference = "Stop"

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Hint
    )
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatório não encontrado: '$Name'. $Hint"
    }
}

function Run {
    param(
        [Parameter(Mandatory = $true)][string]$Cmd,
        [Parameter(Mandatory = $true)][string]$WorkingDir
    )
    Push-Location $WorkingDir
    try {
        if ($VerboseLogs) { Write-Host "==> $WorkingDir> $Cmd" }
        & powershell -NoProfile -ExecutionPolicy Bypass -Command $Cmd
        if ($LASTEXITCODE -ne 0) { throw "Falhou (exit=$LASTEXITCODE): $Cmd" }
    }
    finally {
        Pop-Location
    }
}

$RepoRoot = Resolve-Path $PSScriptRoot
$DesktopDir = Join-Path $RepoRoot "openpolvo"
$BackendDir = Join-Path $RepoRoot "openpolvobackend"
$IntelDir = Join-Path $RepoRoot "openpolvointeligence"

Write-Host "Open Polvo setup (Windows)"
Write-Host "Repo: $RepoRoot"

Assert-Command -Name "node" -Hint "Instale Node.js LTS (inclui npm)."
Assert-Command -Name "npm" -Hint "Instale Node.js LTS (inclui npm)."

if (-not (Test-Path $DesktopDir)) { throw "Diretório não encontrado: $DesktopDir" }
if (-not (Test-Path $BackendDir)) { Write-Host "Aviso: backend dir não encontrado (ok para desktop-only): $BackendDir" }
if (-not (Test-Path $IntelDir)) { Write-Host "Aviso: intelligence dir não encontrado (ok para desktop-only): $IntelDir" }

Write-Host "==> Node: $(node -v)"
Write-Host "==> npm:  $(npm -v)"

if (-not $SkipBuild) {
    Write-Host "==> Instalar dependências do desktop (npm)"
    $Lock = Join-Path $DesktopDir "package-lock.json"
    if (Test-Path $Lock) {
        Run -WorkingDir $DesktopDir -Cmd "npm ci"
    }
    else {
        Run -WorkingDir $DesktopDir -Cmd "npm install"
    }

    Write-Host "==> Build instalador Windows (dist:win)"
    Run -WorkingDir $DesktopDir -Cmd "npm run dist:win"
}
else {
    Write-Host "==> SkipBuild selecionado; pulando build."
}

$distPick = Get-ChildItem -Path $DesktopDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "dist-electron*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
$DistDir = if ($distPick) { $distPick.FullName } else { $null }
if (-not $DistDir -or -not (Test-Path $DistDir)) {
    throw "Build não gerou diretório dist-electron* em: $DesktopDir"
}

$Candidates = Get-ChildItem -Path $DistDir -Recurse -File |
    Where-Object { $_.Extension -in ".exe",".msi" }

$Installers = $Candidates |
    Where-Object { $_.FullName -notmatch "\\win-unpacked\\" } |
    Sort-Object @{ Expression = { $_.Name -match "(setup|installer)" }; Descending = $true }, LastWriteTime -Descending

if (-not $Installers -or $Installers.Count -eq 0) {
    $Portable = $Candidates |
        Where-Object { $_.FullName -match "\\win-unpacked\\.+\.exe$" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($Portable) {
        Write-Host "Aviso: não encontrei instalador (NSIS/MSI) em $DistDir."
        Write-Host "Encontrei apenas a app empacotada (portável):"
        Write-Host "    $($Portable.FullName)"
        Write-Host "Para gerar instalador, rode sem -SkipBuild (isso executa electron-builder --win)."
    }
    else {
        Write-Host "Aviso: não encontrei nenhum .exe/.msi em $DistDir."
        Write-Host "Verifique logs do electron-builder."
    }
}
else {
    $Latest = $Installers[0].FullName
    Write-Host "==> Instalador gerado:"
    Write-Host "    $Latest"

    if ($Install) {
        Write-Host "==> Instalando (modo silencioso quando suportado)"
        if ($Latest.ToLower().EndsWith(".exe")) {
            # NSIS: /S = silent
            & $Latest /S
        }
        else {
            # MSI: /qn = quiet
            & msiexec.exe /i "`"$Latest`"" /qn
        }
        Write-Host "==> Instalação concluída."
    }
}

Write-Host "Concluído."
