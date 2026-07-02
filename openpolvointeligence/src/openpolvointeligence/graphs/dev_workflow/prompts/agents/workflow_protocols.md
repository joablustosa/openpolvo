# Protocolos por workflow

## Hierarquia de ficheiros (obrigatório)

- **Nova app (`new_app`)** com workspace aberto: todo o código vive em `projects/<slug>/` (ex.: `projects/festas-kids/package.json`, `projects/festas-kids/src/...`). **Nunca** escrever na raiz do workspace nem fora de `projects/`.
- **Feature / edit / debug / refactor** em projecto existente: ler e editar ficheiros **no caminho actual** (`projects/<slug>/...` ou subpastas `frontend/`, `backend/`). Não mover o projecto nem duplicar paths.
- Paths sempre **relativos POSIX** (sem `..`, sem absolutos). O runtime prefixa `projects/<slug>/` automaticamente para `new_app`.

### QUANDO ATIVADO NO `new_app_workflow`

1. Criar `projects/<slug>/` (e `.gitignore` dentro do slug).
2. Scaffold e código **só** sob `projects/<slug>/`.
3. `git init` e `npm install` **dentro** de `projects/<slug>/` (ou `frontend/` se monorepo).
4. Validar com `tsc` / `npm run build` no cwd do projecto.

Após geração: `.env.example`, README em `projects/<slug>/`, docker-compose se stack fullstack.

### QUANDO ATIVADO NO `feature_workflow`

Coleta no cwd do projecto existente: `git log`, `git status`, `grep` pela feature, rotas, tipos, schema DB, testes, **tsc baseline**.

Após implementar: `tsc`, eslint, `npm test`, commit `feat(scope): ...`.

### QUANDO ATIVADO NO `edit_workflow`

Ler ficheiro completo no path actual, grep referências, imports/exports, validar `tsc`, testes do módulo.

### QUANDO ATIVADO NO `delete_workflow`

Mapear referências no projecto actual; deletar dependentes primeiro; `eslint --fix`; `tsc`.

### QUANDO ATIVADO NO `debug_workflow`

Reproduzir erro no cwd do projecto; `git log`/`git diff` no ficheiro; fix + `tsc` + testes.

### QUANDO ATIVADO NO `refactor_workflow`

Refactor incremental no projecto actual com `tsc`/`test` a cada passo.

### QUANDO ATIVADO NO `api_design_workflow`

Ler rotas e handlers existentes no projecto actual; validar contratos com `tsc` após stubs.
