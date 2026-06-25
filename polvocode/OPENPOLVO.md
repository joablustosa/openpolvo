# OpenPolvo — polvocode

IDE baseada no VS Code com modos **Agente**, **Workflow** e **Code**, integrada ao backend OpenPolvo oficial (`openpolvobackend` + `openpolvointeligence`).

## Início rápido (dev local)

```powershell
# 1. Intelligence (terminal 1)
cd openpolvointeligence
uv run uvicorn openpolvointeligence.api.app:app --host 127.0.0.1 --port 8090

# 2. Backend Go (terminal 2)
cd openpolvobackend
go run ./cmd/openlaele-api
# HTTP_ADDR=:8081

# 3. polvocode (terminal 3)
cd polvocode
npm install
npm run transpile-client

$env:OPENPOLVO_API_BASE_URL = "http://127.0.0.1:8081"
$env:OPENPOLVO_AGENT_ENABLED = "true"
$env:NODE_ENV = "development"
$env:VSCODE_DEV = "1"
# Lançar Electron — ver scripts/code.bat ou electron em .build/electron após prelaunch
.\scripts\code.bat
```

Se `code.bat` falhar por falta de Windows SDK no branding do Electron, extrair o binário do cache e lançar `electron.exe` com `cwd` em `polvocode/` (ver notas em `MIGRATION.md`).

## Primeiro uso

1. Abra a IDE e use **Agente**, **Workflow** ou **Code** na title bar.
2. Faça login OpenPolvo (`Sign in to OpenPolvo`). Conta de dev local: `admin@openlaele.local` / password em `openpolvobackend/.env` (`DEFAULT_ADMIN_PASSWORD`).
3. **Agente** — chat com tools locais (filesystem, terminal, git).
4. **Workflow** — automações em linguagem natural via `/v1/workflows/generate`.
5. **Code** — editor VS Code + dev workflow (apply de ficheiros no workspace).

## Documentação

| Recurso | Caminho |
|---------|---------|
| Migração do frontend antigo | [`MIGRATION.md`](MIGRATION.md) |
| Contrato HTTP (monorepo) | [`../docs/desk-api-contract.md`](../docs/desk-api-contract.md) |
| Módulo polvoModes (IDE) | [`src/vs/workbench/contrib/polvoModes/`](src/vs/workbench/contrib/polvoModes/) |
| Protocolo backend | [`src/vs/platform/agentHost/common/openpolvoBackendProtocol.ts`](src/vs/platform/agentHost/common/openpolvoBackendProtocol.ts) |
| Agent Host OpenPolvo | [`src/vs/platform/agentHost/node/openpolvo/`](src/vs/platform/agentHost/node/openpolvo/) |

## Configurações principais

| Setting | Default |
|---------|---------|
| `openpolvo.api.baseUrl` | `http://127.0.0.1:8081` |
| `openpolvo.api.token` | (definido no login) |
| `openpolvo.agent.enabled` | `true` |
| `openpolvo.workflows.useBackend` | `true` |
| `openpolvo.devWorkflow.enabled` | `true` |

Variáveis de ambiente: `OPENPOLVO_API_BASE_URL`, `OPENPOLVO_API_TOKEN`, `OPENPOLVO_AGENT_ENABLED`.

## Smoke test (integração)

Na raiz do monorepo (script local, pasta `scripts/` no `.gitignore`):

```powershell
powershell -File scripts/polvocode-endpoints-test.ps1
```
