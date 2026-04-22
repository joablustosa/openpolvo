# Open Polvo Intelligence

Serviço Python (**FastAPI** + **LangGraph**) com o agente **Zé Polvinho** e os LLMs auxiliares (geração de workflows e nós `llm` no runner). A API Go continua a expor autenticação, conversas e persistência; este processo calcula apenas as respostas do modelo.

## Requisitos

- Python 3.11+
- Pelo menos uma de: `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `POLVO_INTERNAL_KEY` igual ao configurado na API Go (`POLVO_INTELLIGENCE_INTERNAL_KEY`)

## Arranque rápido

```bash
cd openpolvointeligence
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -e ".[dev]"
copy .env.example .env   # edite chaves
python -m openpolvointeligence.main
```

Por defeito o serviço escuta em `http://127.0.0.1:8090`.

## Endpoints

| Método | Caminho | Auth |
|--------|---------|------|
| GET | `/healthz` | — |
| GET | `/readyz` | — (503 se não houver chaves LLM) |
| POST | `/v1/reply` | `X-Open-Polvo-Internal-Key` |
| POST | `/v1/workflows/generate` | idem |
| POST | `/v1/llm/generate-text` | idem |
| GET | `/v1/capabilities` | idem |

## Organização do código

- `src/openpolvointeligence/api/` — FastAPI, schemas, rotas
- `src/openpolvointeligence/graphs/` — LangGraph (`zepolvinho_graph.py`), plugins nativos, LLM de workflows; cada intenção encaminhada usa o `specialist_*.md` correspondente
- `src/openpolvointeligence/prompts/` — prompts Markdown (analisador, formatação, especialistas por rota)
- `src/openpolvointeligence/core/` — configuração

## Testes

```bash
pytest
```

## Integração com a API Go

Defina na API Go `POLVO_INTELLIGENCE_BASE_URL` (ex.: `http://127.0.0.1:8090`) e `POLVO_INTELLIGENCE_INTERNAL_KEY` igual a `POLVO_INTERNAL_KEY` deste serviço. Ver [README do backend](../openpolvobackend/README.md).

O corpo de `POST /v1/reply` e `POST /v1/reply/stream` pode incluir:

- **`smtp_context`** (opcional): metadados do SMTP do utilizador (sem password); o envio real continua a ser feito pela API Go (`POST /v1/email/send`).
- **`contacts_context`** (opcional): contactos (`id`, `name`, `phone`, `email`) para o agente reconhecer destinatários pelo nome.
- **`task_lists_context`** (opcional): listas de tarefas persistidas (`id`, `title`, `status`, `items[]` com `id`, `position`, `title`, `status`, `description?`, `result_preview?`) para o especialista `gestao_tarefas_calendario` contar, resumir ou planear mutações.

Na resposta, quando a intenção encaminhada for **`gestao_tarefas_calendario`**, o serviço pode incluir em **`metadata`** (objecto JSON junto de `assistant_text`):

- `task_list_ops_pending` (boolean) — se a UI deve aplicar operações com a sessão do utilizador.
- `task_list_ops_blocked` (boolean) — se algo impediu a aplicação automática.
- `task_list_ops_errors` (array de strings, opcional) — erros de validação (ex.: UUID desconhecido).
- `task_list_ops` (array) — operações no formato esperado por `POST /v1/task-lists/batch` na API Go (`op`, `list_id`, `item_id`, `title`, `items`, `ids`, etc.).

O cliente **não** deve executar operações se `task_list_ops_blocked` for verdadeiro ou se `task_list_ops_pending` for falso.
