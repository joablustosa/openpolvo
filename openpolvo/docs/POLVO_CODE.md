# Polvo Code (desktop)

## O que está implementado

- **Gravar o artefacto do Builder em disco** (`userData/polvo-code-projects/<slug>-<id>/`).
- **Painel “Polvo Code”** no `SitePanel` quando o plugin nativo `polvo_code` está activo.
- **Terminal integrado (log)** via IPC: `npm install`, `npm run dev` com host/porta locais, detecção do URL do Vite no stdout e **abertura no navegador** (`shell.openExternal`).
- **Explorador de ficheiros** (`showItemInFolder`) e **editor externo** (tenta `cursor` / `code` no PATH ou `POLVO_CODE_EDITOR`).

## Integração futura com Code-OSS (`joabcode`)

O repositório `joabcode` é uma árvore **Code - OSS / VS Code**. Para embutir o workbench completo no Open Polvo:

1. **Build** do produto a partir de `joabcode` (scripts `compile` / `gulp` conforme a wiki do VS Code).
2. **Empacotar** o output (ou um binário `code-oss`) como recurso extra do `electron-builder` do Open Polvo.
3. **Segunda `BrowserWindow`** ou processo filho que arranca o workbench com `--folder-uri` / `--add` apontando para `workspacePath` devolvido por `polvoCode:writeProject`.
4. **Extensão “Polvo Agent”** dentro do Code-OSS: chat lateral + tools que chamam a mesma API Go/stream que o Open Polvo já usa (HTTP local ou bridge IPC via um mini-serviço no host).

Até lá, o fluxo **code-first** usa o painel Polvo Code + terminal + browser; o botão **Editor externo** abre Cursor/VS Code na pasta do projecto quando disponível no sistema.

## Variáveis de ambiente

| Variável | Efeito |
|----------|--------|
| `POLVO_CODE_EDITOR` | Comando completo para abrir o editor com a pasta do projecto (ex.: `C:\\Apps\\Cursor\\Cursor.exe`). |
