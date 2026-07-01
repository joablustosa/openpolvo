# Guia — Automações (Workflow) no OpenPolvo

> Como configurar SMTP e criar a automação **Pesquisa na internet → E-mail** que corre
> sozinha num horário fixo. Toda a base já existe no produto; este guia documenta o
> caminho e o que foi polido em 2026-07-01.

## 1. Configurar o e-mail (SMTP) — uma vez

No app (polvocode), abra a paleta de comandos e execute **"OpenPolvo: Configurar SMTP
(e-mail)"** (`polvo.settings.smtp`). Preencha host, porta, utilizador e senha; o comando
grava via `PUT /v1/me/smtp` (senha cifrada AES-GCM no backend) e pode testar com
`POST /v1/me/smtp/test`.

> Sem SMTP configurado, o nó `send_email` falha com mensagem clara ("envio de email não
> configurado no servidor").

## 2. Criar a automação Pesquisa → E-mail

Modo **Automações** (switcher de modos) → painel de automações:
- **1 clique:** botão **"Exemplo: Pesquisa na internet → E-mail (diário)"** no estado vazio
  — preenche um prompt pronto e gera a automação por linguagem natural.
- **Manual:** descreva no campo, ex.: *"Todos os dias às 8h, pesquise as principais
  notícias sobre IA, resuma e envie por e-mail para mim@exemplo.com"*.

O grafo gerado/preset é: `schedule` (cron) → `web_search` (com enriquecimento) →
`send_email`. Template determinístico disponível também via `GET /v1/workflows/templates`
(id `research_email`).

### Anatomia do template (perfeito por omissão)
- **schedule**: `0 8 * * *`, timezone `America/Sao_Paulo`, `schedule_enabled=true`.
- **web_search**: query do utilizador, `m=8`, `web_search_skip_page_fetch=false` →
  o servidor pede ao Intelligence *fetch* (trafilatura) + resumo por URL ("melhora a pesquisa").
- **send_email**: assunto fixo + corpo com `{{output:search-1}}` (o motor substitui pela
  saída enriquecida da pesquisa antes de enviar).

## 3. Como o serviço executa (agendamento)

- O backend inicia o **scheduler de workflows** no boot (`StartWorkflowScheduler`,
  ligado por omissão; `WORKFLOW_SCHEDULER_ENABLED`).
- A cada tick, avalia workflows com `schedule_cron` ativo; quando é a hora, **enfileira**
  (schedulequeue) e o worker corre o grafo (`RunWorkflow`), registando cada passo
  (`GET /v1/workflows/{id}/runs`).
- O cron/timezone vêm do nó `schedule` do grafo (`ApplyScheduleFromGraph`).

## 4. Requisitos de servidor
- `SERPAPI_API_KEY` — para o nó `web_search` (senão o passo falha com mensagem clara).
- SMTP configurado (passo 1) — para o `send_email`.
- Ambos funcionam com **Ollama local ou keys** (o envio/pesquisa não dependem do LLM;
  o enriquecimento usa o provider configurado).

## 5. Encadear um resumo por LLM (opcional, agora suportado)
Desde 2026-07-01 o nó `llm` também expande `{{previous}}` / `{{output:ID}}` no prompt.
Isso permite `web_search → llm (resumo) → send_email`, ex.: prompt do `llm`
*"Resuma em português, com bullets e links: {{output:search-1}}"* e o `send_email` usa
`{{output:<id do llm>}}`.

## Auditoria (arestas encontradas) — 2026-07-01
- ✅ **Corrigido:** o nó `llm` não expandia templates — prompts com `{{output:…}}`
  eram enviados literalmente ao modelo. Agora expande (igual a `send_email`).
- ℹ️ **Dependências externas** (`SERPAPI_API_KEY`, SMTP) falham com mensagem acionável,
  não silenciosamente — bom. Documentado acima.
- ⛳ **Frontend:** o botão de exemplo foi adicionado seguindo os padrões do `polvoModes`,
  mas **não** foi verificado por transpile neste ambiente (sem `node_modules`). Rodar
  `npm run transpile-client` antes de publicar.
