# OpenPolvo — polvocode

IDE baseada no VS Code com modos **Agente**, **Workflow** e **Code**, integrada ao backend OpenPolvo oficial (`openpolvobackend` + `openpolvointeligence`).

## Início rápido (dev local)

**Pré-requisitos:** Node 24.x (`.nvmrc`), VS Build Tools 2022 (C++). Em Windows sem libs Spectre, o script `rebuild-natives.ps1` aplica patch automático.

```powershell
# Setup (uma vez, ou após mudar package-lock.json)
cd polvocode
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

# Arranque da IDE (com backend em :8081 e intelligence em :8090)
powershell -ExecutionPolicy Bypass -File scripts/dev-launch.ps1

# Dev com recompilação contínua (terminal separado)
npm run watch
```

| Script | Função |
|--------|--------|
| `scripts/setup-dev.ps1` | `npm ci` + postinstall + transpile + nativos |
| `scripts/dev-launch.ps1` | Lança `Open Polvo.exe` com env OpenPolvo |
| `scripts/rebuild-natives.ps1` | Recompila `.node` para Electron (Windows) |
| `scripts/install-vs-spectre.ps1` | Instala libs Spectre (Admin, opcional) |
| `scripts/code.bat` | Launcher upstream VS Code OSS |

**Troubleshooting Windows:** se `npm install` falhar com EBUSY em `@playwright`, feche outros processos no `polvocode` e repita o setup. Se MSB8040 (Spectre), execute `rebuild-natives.ps1` ou `install-vs-spectre.ps1` como Administrador.

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
