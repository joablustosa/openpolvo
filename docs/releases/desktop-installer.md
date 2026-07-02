# Open Polvo — instalador desktop

Gera um instalador Windows com **frontend (Electron)**, **backend (Go)** e **intelligence (Python)** embutidos.

## Pré-requisitos

| Ferramenta | Versão |
|------------|--------|
| Go | 1.25+ |
| Node.js | 20+ |
| uv (Python) | 3.11+ |
| Inno Setup | via `npm ci` no `polvocode` (pacote `innosetup`) |

## Build

```powershell
cd c:\openpolvo
powershell -ExecutionPolicy Bypass -File tools\build-desktop-installer.ps1
```

Saída:

- `dist\desktop\OpenPolvo-UserSetup-x64.exe` — instalador per-user
- Pasta portátil: `VSCode-win32-x64\` (ao lado de `polvocode/`)

### Opções

```powershell
# Só pasta empacotada (sem Inno Setup) — mais rápido para testar
.\tools\build-desktop-installer.ps1 -SkipInstaller

# Reutilizar compilação Electron existente
.\tools\build-desktop-installer.ps1 -SkipElectronCompile
```

## Primeiro arranque

1. Instale o `.exe` ou execute `Open Polvo.exe` na pasta portátil.
2. O app arranca automaticamente backend (`:8081`) e intelligence (`:8090`).
3. Instale [Ollama](https://ollama.com/) e `ollama pull llama3.2` para LLM local gratuito.
4. Login: `admin@openlaele.local` / `ChangeMeLocalDev_Only` (altere após o primeiro uso).

## Serviços externos (avançado)

Para usar backend/intelligence à parte (dev ou servidor):

```powershell
$env:OPENPOLVO_EXTERNAL_SERVICES = '1'
& "C:\Program Files\Open Polvo\Open Polvo.exe"
```

## Arquitectura

```
resources/
  openpolvo/
    manifest.json      # segredos gerados no build (JWT + chave interna)
    backend/
      openlaele-api.exe
      migrations/
    intelligence/
      openpolvointel.exe
      _internal/       # PyInstaller onedir
```

O arranque em produção está em `polvocode/src/vs/platform/openpolvo/electron-main/openPolvoBundledServices.ts`.
