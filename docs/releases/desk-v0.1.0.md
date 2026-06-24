# Open Polvo Desk MVP v0.1.0

**Tag:** `desk-v0.1.0`  
**Data:** 2026-06-24

## Resumo

Primeira release focada no **Open Polvo Desk**: agente local com LangGraph, tools de filesystem/terminal/git, memória por conversa e instalador desktop Windows com Ollama como provider default.

## Destaques

### Agent Mode
- Chat com `desk_context` (workspace, mode, conversation_id)
- Painel de logs com eventos `tool_call`, `tool_result`, `thought`
- Execução de tools via IPC no Electron

### Code Mode
- Dev Studio embutido no workspace escolhido
- Sem rotas legacy do Zé Polvinho

### Runtime
- Grafo `desk_graph` (LangGraph ReAct)
- Ollama local; Anthropic/OpenAI opcionais com flag
- `/readyz` verifica Ollama quando aplicável

### Memória
- Histórico persistido em SQLite (Go)
- Bloco de memória injectado no system prompt
- Trim: últimas 20 mensagens + ~4k chars de memória

## Instalação

1. Descarregar o instalador Windows da release `desk-v0.1.0`.
2. Instalar [Ollama](https://ollama.com/) e `ollama pull llama3.2` (ou modelo equivalente).
3. Arrancar a app — backend e intelligence embutidos no desktop.

## Desenvolvimento

Ver [desk-mvp-quickstart.md](../desk-mvp-quickstart.md).

## Smoke checklist (validado na release)

- [x] Arranque 3 stacks (healthz / readyz)
- [x] Routing Desk sem payloads legacy
- [x] Tools: `filesystem_list`, `echo ok`, `git status` (fixtures)
- [x] Contrato pydantic + Go JSON
- [x] Memória: inject + truncagem + patch metadata
- [ ] E2E manual: UI Agent Mode + reinício app (validar localmente)

## Breaking / scope

- Não inclui: multiagente, RAG avançado, marketplace, cloud obrigatória, Flow Mode completo.
- Zé Polvinho (finanças, social, automações) permanece no código mas oculto em `DESK_MVP_MODE`.

## Artefactos

- `Open Polvo Setup x.x.x.exe` (NSIS, Windows x64)
- Binários embutidos: `openlaele-api.exe`, `openpolvointel/` (PyInstaller)

## Créditos

Open Polvo Desk MVP — milestone M0–M5.
