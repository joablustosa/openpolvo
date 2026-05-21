# Polvo Code (desktop)

## O que está implementado

- **Chat → metadata → disco**: quando o Intelligence devolve `polvo_code_ops_pending` com operações `write`/`mkdir`, o cliente (Electron) aplica ficheiros via IPC (`polvoCode:writeProject`, `polvoCode:writeFile`, `polvoCode:mkdir`), opcionalmente `npm install` e `npm run dev`, e abre o plugin **Polvo Code**.
- **Gravar o artefacto do Builder em disco** (`userData/polvo-code-projects/<slug>-<id>/`).
- **Painel “Polvo Code”** no `SitePanel` quando o plugin nativo `polvo_code` está activo.
- **Preview + consola**: painel com **`<webview>`** do Electron (mesmo padrão que os plugins no `SitePanel`) para o `devUrl` do Vite — evita bloqueios de `X-Frame-Options` / sandbox de `<iframe>` entre origens (`:5174` shell vs `:5175` projecto). Recarregar preview, consola embutida e overlay durante aplicação de ficheiros (eventos `polvo-code-apply-*`).
- **Terminal integrado (log)** via IPC: `npm install`, `npm run dev` com host/porta locais, detecção do URL do Vite no stdout e **abertura no navegador** (`shell.openExternal`).
- **Explorador de ficheiros** (`showItemInFolder`) e **editor externo** (tenta `cursor` / `code` no PATH ou `POLVO_CODE_EDITOR`).

## Integração futura com Code-OSS (`joabcode`)

O repositório `joabcode` é uma árvore **Code - OSS / VS Code**. Para embutir o workbench completo no Open Polvo:

1. **Build** do produto a partir de `joabcode` (scripts `compile` / `gulp` conforme a wiki do VS Code).
2. **Empacotar** o output (ou um binário `code-oss`) como recurso extra do `electron-builder` do Open Polvo.
3. **Segunda `BrowserWindow`** ou processo filho que arranca o workbench com `--folder-uri` / `--add` apontando para `workspacePath` devolvido por `polvoCode:writeProject`.
4. **Extensão “Polvo Agent”** dentro do Code-OSS: chat lateral + tools que chamam a mesma API Go/stream que o Open Polvo já usa (HTTP local ou bridge IPC via um mini-serviço no host).

Até lá, o fluxo **code-first** usa o painel Polvo Code + terminal + browser; o botão **Editor externo** abre Cursor/VS Code na pasta do projecto quando disponível no sistema.

## API Go (opcional)

- `POST /v1/polvo-code/validate-ops` — valida lista de operações (caminhos relativos, tamanhos) antes de o desktop aplicar; resposta JSON `{ "ok", "valid_ops", "errors" }`.

## Variáveis de ambiente

| Variável | Efeito |
|----------|--------|
| `POLVO_CODE_EDITOR` | Comando completo para abrir o editor com a pasta do projecto (ex.: `C:\\Apps\\Cursor\\Cursor.exe`). |
| `OPEN_POLVO_PREVIEW_CSP_PORTS` | Lista de portos (ex.: `5175,5180`) onde o `main.cjs` injecta CSP e remove `X-Frame-Options` para o preview embutido. |
| `OPEN_POLVO_PREVIEW_FRAME_ANCESTORS` | Origens extra permitidas em `frame-ancestors` da CSP do preview (separadas por vírgula), além da shell Vite (`:5174`) e `file:`. |
