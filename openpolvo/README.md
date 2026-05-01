# Open Polvo — frontend + shell Electron

## Desenvolvimento

```bash
npm ci
npm run dev
```

Requer backend Go e serviço Python a correr (ex.: `scripts/restart-local.ps1` na raiz do repositório).

## Instalador Windows (`Setup.exe`)

1. Instale [Go](https://go.dev/dl/), [Python 3.11+](https://www.python.org/downloads/) e Node 20+.
2. Gere os binários empacotados (a partir da pasta `openpolvo`):

   ```powershell
   cd openpolvo
   ./build-desktop-artifacts.ps1
   ```

3. No diretório `openpolvo`:

   ```powershell
   npm ci
   npm run dist:win
   ```

   O artefacto NSIS fica em `openpolvo/dist-electron/`. Se os binários já existirem (CI), use `npm run dist:win:pack` (só Vite + electron-builder).

O ficheiro [`electron-builder.yml`](electron-builder.yml) define `win.signAndEditExecutable: false` para que o build não tente extrair a cache `winCodeSign` (em alguns PCs o 7-Zip falha ao criar symlinks sem modo de programador Windows). Se precisar de assinatura Authenticode, remova esta opção e use uma máquina ou CI com permissões adequadas.

### Actualizações automáticas (GitHub)

O [`electron-builder.yml`](electron-builder.yml) define `publish.provider: github`. Ajuste `owner` / `repo` ao seu GitHub. Cada release com tag `desktop-v*` (ou execução manual do workflow) publica `latest.yml` e o instalador; a app empacotada verifica novas versões ao arranque e a cada 6 horas.

Para publicar a partir da sua máquina (token com scope `repo`):

```powershell
$env:GH_TOKEN="ghp_…"
cd openpolvo
npm run dist:win
npx electron-builder --win --publish always
```

### Primeira execução

Na instalação empacotada, o assistente pede chaves LLM (OpenAI e/ou Google) e opcionalmente SMTP; são criados `backend.env` e `intelligence.env` em `%APPDATA%/Open Polvo/`.
