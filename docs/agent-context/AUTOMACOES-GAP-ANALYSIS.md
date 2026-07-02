# Automações (Workflow) — análise de gaps (22 itens)

> Estado por item vs. Cursor/n8n/Zapier. Baseado em `openpolvobackend/internal/workflows`
> (domain/graph.go, engine/runner.go, engine/dag.go, application/*), API (`router.go`) e
> frontend `polvoModes`. Última revisão: 2026-07-01. Legenda: ✅ feito · 🟡 parcial · ⛔ falta.

## ⚡ Atualização 2026-07-01 — P0 entregue (frontend)
Itens 8, 9 e 10 saíram do estado "backend-only": o frontend `polvoModes` ganhou
`runWorkflow`/`getWorkflowRuns`/`getWorkflowTemplates`/`createWorkflowFromGraph` no api
service, **"Executar agora"** e **"Ver execuções"** (com logs por passo) no menu do
workflow, e o botão de exemplo passou a criar o **template determinístico** via backend.
⚠️ Ressalva: `RunGraph` inicializa Playwright sempre; o "Executar agora" do template
sem browser falha com mensagem clara se o Chromium não estiver instalado (backend).
Não verificável por transpile neste ambiente.

## ⚡ Atualização 2026-07-01 — P1 (parte 1): nó HTTP + retry por passo
- **Item 5 (nó HTTP) ✅**: novo tipo `http`/`http_request` no engine — method/headers/body,
  URL/body/headers com `{{output:ID}}`, guard SSRF (`isSafePublicURL`), saída em `outputs[id]`.
- **Item 11 (retry) ✅ (rede)**: campo `Retries`/`RetryDelayMs` no NodeData + `withRetry`;
  aplicado a `http`, `web_search` e `send_email` (nós de rede). Nós de browser já têm timeout.
- Arquivos: `engine/http_node.go`, `domain/graph.go`, `engine/runner.go`. 10 testes.
- **Falta (P1 parte 2):** condicional (12) e aprovação humana (13) — mudam o modelo de
  execução (branching / pause-resume) e o contrato do grafo (edge labels) → design a confirmar.

## Resumo executivo
Fundação **forte e funcional**: NL→grafo, scheduler+fila, cron+timezone, canvas, nós
web/email/LLM, templates, passagem de dados, SMTP/keys. Os **gaps** concentram-se em:
(a) **fluxo avançado** (condicional, aprovação, retry, dry-run), (b) **gatilhos** além de
cron (webhook/evento), (c) **integrações** além de redes sociais (Slack/GitHub/Google/HTTP),
(d) **surface no frontend** de coisas que já existem no backend (run-now, histórico/logs),
(e) **gestão** (duplicar, versionar, export/import, quotas, galeria).

## Tabela por item

| # | Item | Estado | Onde está / o que falta |
|---|------|:------:|--------------------------|
| 1 | NL → grafo | ✅ | `application/generate.go` + `/v1/workflows/generate` + front `generateWorkflow` |
| 2 | Scheduler + fila | ✅ | `scheduler_loop.go` + `schedulequeue`; ligado por omissão |
| 3 | Cron / intervalo / timezone | ✅ | `ScheduleNextUTC` (cron + IANA tz). "Intervalo" via cron (`*/15 * * * *`); campo `interval` nativo ⛔ (não necessário) |
| 4 | Editor visual (canvas) | 🟡 | `polvoWorkflowCanvas.ts` renderiza nós/arestas com ícones; **edição interativa (arrastar/criar/ligar) a confirmar** |
| 5 | Nós de ação (web/email/HTTP/LLM) | 🟡 | web_search ✅, send_email ✅, llm ✅; **nó HTTP genérico ⛔** (só automação de browser goto/click/fill via Playwright) |
| 6 | Credenciais (SMTP, API keys) | ✅ | SMTP `/me/smtp` (AES-GCM) + keys `llmprofiles`; tokens sociais (Meta) parciais |
| 7 | Passagem de dados (outputs/templates) | ✅ | `{{previous}}` / `{{output:ID}}` (agora também no nó `llm`) |
| 8 | Templates 1 clique | 🟡 | `domain/templates.go` (research_email) + `/v1/workflows/templates` + botão; **botão usa NL, não o endpoint determinístico** (falta `getWorkflowTemplates`/create-from-graph no front) |
| 9 | Run now + histórico | 🟡 | **Backend ✅** (`/run`, `/runs`, `list_runs`); **Frontend ⛔** (api service não tem `runWorkflow`/`getWorkflowRuns`; sem botão "executar agora" nem ecrã de histórico) |
| 10 | Logs por passo / observabilidade | 🟡 | Backend ✅ (`StepLogEntry` por nó em cada run); **UI de logs ⛔** (não há ecrã de runs no front) |
| 11 | Erro + retry por passo | 🟡 | Erro por passo ✅ (fail-fast com mensagem); **retry por passo ⛔** (sem campo/política de retry) |
| 12 | Ramos condicionais (if/else) | ⛔ | `OrderNodes` é DAG topológico linear; **sem nó condicional/branch** |
| 13 | Human-in-the-loop (aprovação) | ⛔ | Sem nó de aprovação/pausa no meio do fluxo |
| 14 | Gatilhos por evento (webhook/email/ficheiro) | ⛔ | Só gatilho `schedule` (cron); **sem webhook/evento** |
| 15 | Nós de integração (Slack/GitHub/Google/social) | 🟡 | **Social ✅** (facebook/instagram/whatsapp/linkedin/x/youtube); **Slack ⛔, GitHub ⛔, Google ⛔** |
| 16 | Segredos/env por workflow | ⛔ | Credenciais são globais (por utilizador); **sem secrets/variáveis por workflow** |
| 17 | Notificações sucesso/falha | ⛔ | Sem sistema de notificação de run (dá para montar um `send_email` no fluxo, mas built-in ⛔) |
| 18 | Simulação / dry-run | ⛔ | Sem modo dry-run/preview de execução |
| 19 | Versionamento / duplicação / edição | 🟡 | Edição ✅ (`updateWorkflow`/PATCH); **duplicação ⛔** e **versionamento ⛔** |
| 20 | Limites / quotas / concorrência | 🟡 | `schedulequeue` faz dedupe/serialização (concorrência básica); **quotas/limites explícitos ⛔** |
| 21 | Partilha / export / import | ⛔ | Sem export/import de workflows (o grafo é JSON, mas não há endpoint/UI) |
| 22 | Galeria / marketplace | 🟡 | `/templates` (1 preset) é a semente; **galeria/marketplace ⛔** |

## O que NÃO temos (foco do pedido)

**Ausentes (⛔):** 12 condicional, 13 aprovação humana, 14 gatilhos por evento,
16 segredos por workflow, 17 notificações, 18 dry-run, 21 export/import.
**Sub-itens ausentes dentro de parciais:** nó HTTP (5), retry (11), Slack/GitHub/Google (15),
duplicação+versionamento (19), quotas (20), galeria (22).
**Existe no backend, falta no frontend:** run-now (9), histórico/logs de execução (9,10),
endpoint de templates determinístico (8), pin.

## Prioridade sugerida (impacto × esforço)
1. **P0 — Surface o que já existe no front:** run-now + histórico/logs de runs (9,10) e
   templates determinísticos (8). Backend pronto; é wiring no `polvoModes`.
2. **P1 — Nó HTTP genérico (5)** e **retry por passo (11)** — pequenos no engine, alto valor.
3. **P1 — Condicional if/else (12)** e **aprovação humana (13)** — fluxo avançado.
4. **P2 — Gatilhos webhook/evento (14)**, **notificações (17)**, **duplicar/export (19,21)**.
5. **P2 — Integrações Slack/GitHub/Google (15)**, **secrets por workflow (16)**, **galeria (22)**.
