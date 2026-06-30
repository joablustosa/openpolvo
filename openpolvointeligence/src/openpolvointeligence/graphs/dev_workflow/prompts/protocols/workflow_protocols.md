# Protocolos por workflow

### QUANDO ATIVADO NO `new_app_workflow`

Antes de gerar código: mapear diretório (`ls`, `find`), inicializar git e `.gitignore`, criar `package.json` com workspaces se aplicável, `npm install`, validar com `tsc`.

Após geração: `tsc`, `npm run build`, `npm test`, `.env.example`, README, docker-compose se stack fullstack.

### QUANDO ATIVADO NO `feature_workflow`

Coleta: `git log`, `git status`, `grep` pela feature, rotas (`App.tsx`/`routes.ts`), tipos, schema DB, `.env.example`, testes existentes, **tsc baseline antes de mudar**.

Após implementar: `tsc`, eslint, `npm test`, commit `feat(scope): ...`.

### QUANDO ATIVADO NO `edit_workflow`

Ler ficheiro completo, grep referências ao símbolo, imports/exports, validar `tsc` no ficheiro, testes do módulo.

### QUANDO ATIVADO NO `delete_workflow`

Mapear referências, imports, testes, rotas; gerar relatório de impacto; deletar dependentes primeiro; `eslint --fix`; `tsc`.

### QUANDO ATIVADO NO `debug_workflow`

Reproduzir erro, localizar ficheiro, `git log`/`git diff` no ficheiro, `tsc` focado, fix + `tsc` + testes.

### QUANDO ATIVADO NO `refactor_workflow`

Medir complexidade, grep duplicações, cobertura de testes antes, refactor incremental com `tsc`/`test` a cada passo.

### QUANDO ATIVADO NO `api_design_workflow`

Ler rotas e handlers existentes, OpenAPI/spec no estado, validar contratos com `tsc` após stubs gerados.
