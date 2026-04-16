# Open Polvo (backend)

API em Go com arquitectura hexagonal e DDD para o **Open Polvo**: autenticação (JWT + MySQL), readiness, conversas e workflows. O **agente Zé Polvinho** e os LLMs de geração de workflows correm no serviço Python [**Open Polvo Intelligence**](../openpolvointeligence/README.md) (FastAPI + LangGraph); esta API Go encaminha pedidos via HTTP (`POLVO_INTELLIGENCE_*`).

## Requisitos

- Go 1.24+
- MySQL 8+

## Configuração

1. Copie `.env.example` para `.env` e preencha `JWT_SECRET`.
2. **Open Polvo Intelligence:** defina `POLVO_INTELLIGENCE_BASE_URL` (ex.: `http://127.0.0.1:8090`) e `POLVO_INTELLIGENCE_INTERNAL_KEY` (igual a `POLVO_INTERNAL_KEY` no serviço Python). Arranque o serviço Python e configure lá `OPENAI_API_KEY` e/ou `GOOGLE_API_KEY`. Sem isto, o chat e a geração de workflows por LLM ficam indisponíveis.
3. **MySQL:** ou defines `MYSQL_DSN`, ou (recomendado para **Azure** e passwords com `$`) deixas `MYSQL_DSN` vazio e defines `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PORT` e opcionalmente `MYSQL_TLS=true` (SSL). O servidor escapa a password correctamente ao montar o DSN.
4. No **Azure Database for MySQL**, nas regras de firewall, permite o IP público da máquina que corre a API (erro `1045` ou falha de ligação pode ser firewall ou credenciais).
5. Cria a base de dados referida no DSN (ou usa a que já existes, ex.: `loopa_db`).
6. Na raiz do repositório:

```bash
go run ./cmd/openlaele-api/
```

Com `RUN_MIGRATIONS=true`, no arranque corre-se só **`migrate up`**: aplicam-se migrações **ainda não registadas** na tabela `schema_migrations`. O caminho `MIGRATIONS_PATH` (ex.: `migrations`) é resolvido a partir do directório com **`go.mod`**, não só do cwd — podes arrancar a API mesmo com o cwd noutra pasta (ex. IDE a partir de `OpenLaEleFront`). O `.env` da **raiz do módulo** também é carregado primeiro, depois o `.env` local (Overload). Os ficheiros `.down.sql` **não** correm no startup. As migrações `up` usam `CREATE … IF NOT EXISTS` quando faz sentido; os `down` são **não destrutivos**.

## Primeiro utilizador

- **Por defeito (arranque da API):** com `BOOTSTRAP_DEFAULT_ADMIN=true` (padrão), depois das migrações é garantido um utilizador com `DEFAULT_ADMIN_EMAIL` (padrão `admin@openlaele.local`) se ainda não existir. Se `DEFAULT_ADMIN_PASSWORD` não estiver no `.env`, usa-se a password de desenvolvimento documentada em `.env.example` — **altere em produção**.
- **Seed manual:** `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` e `go run ./cmd/openlaele-seed/`.
- **Registo:** `AUTH_ALLOW_REGISTER=true` e `POST /v1/auth/register` (avaliar risco em produção).

## API (resumo)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | não | Texto `ok`; liveness mínima |
| GET | `/healthz` | não | JSON: `status`, `service`, `version` |
| GET | `/ready` | não | Texto; ping à BD |
| GET | `/readyz` | não | JSON readiness; mesmas dependências que `/ready` |
| POST | `/v1/auth/login` | não | `{"email","password"}` → `access_token` |
| POST | `/v1/auth/register` | não | Se `AUTH_ALLOW_REGISTER=true` |
| GET | `/v1/auth/me` | Bearer JWT | Utilizador actual |
| GET | `/v1/agent/status` | Bearer JWT | Serviço Intelligence: `readyz` + capacidades OpenAI/Google no Python |
| GET | `/v1/agent/langgraph/status` | Bearer JWT | Alias legado do endpoint acima |
| POST | `/v1/agent/langgraph/threads` | Bearer JWT | Cria ID local `go-local:…` (compatibilidade) |
| GET | `/v1/conversations` | Bearer JWT | Listar conversas (fixadas primeiro) |
| POST | `/v1/conversations` | Bearer JWT | Criar conversa (`title?`, `default_model_provider?`) |
| GET | `/v1/conversations/{id}` | Bearer JWT | Obter conversa |
| PATCH | `/v1/conversations/{id}` | Bearer JWT | Renomear (`{"title": "…"}`) |
| DELETE | `/v1/conversations/{id}` | Bearer JWT | Excluir (soft delete) → 204 |
| POST | `/v1/conversations/{id}/pin` | Bearer JWT | Fixar/desafixar (`{"pinned": true/false}`) |
| GET | `/v1/conversations/{id}/messages` | Bearer JWT | Listar mensagens |
| POST | `/v1/conversations/{id}/messages` | Bearer JWT | Enviar mensagem (`text`, `model_provider?`) |
| GET | `/v1/me/smtp` | Bearer JWT | Definições SMTP do utilizador (sem password; `password_set`) |
| PUT | `/v1/me/smtp` | Bearer JWT | Guardar SMTP (`host`, `port`, `username`, `password?`, `from_email`, `from_name`, `use_tls`) — password vazia mantém a anterior |
| POST | `/v1/email/send` | Bearer JWT | Enviar e-mail pela conta SMTP (`to`, `subject`, `body` ou `contact_id` em vez de `to`) |
| GET | `/v1/me/contacts` | Bearer JWT | Listar contactos (nome, telefone, email) |
| POST | `/v1/me/contacts` | Bearer JWT | Criar contacto (`name`, `phone`, `email`) → 201 |
| GET | `/v1/me/contacts/{id}` | Bearer JWT | Obter um contacto |
| PUT | `/v1/me/contacts/{id}` | Bearer JWT | Actualizar contacto |
| DELETE | `/v1/me/contacts/{id}` | Bearer JWT | Eliminar contacto → 204 |

Login: JSON `{"email":"","password":""}` → `access_token`, `token_type`, `expires_in`.

### Soft delete

Conversas eliminadas ficam na base de dados com `deleted_at` preenchido e **nunca aparecem** nas listagens nem em endpoints individuais. Isso permite auditoria e eventual restauro via SQL directo.

### Conversas fixadas

Ao chamar `POST /v1/conversations/{id}/pin` com `{"pinned": true}`, o campo `pinned_at` é preenchido com a data actual. Com `{"pinned": false}`, é anulado. As conversas fixadas aparecem **antes das recentes** em `GET /v1/conversations`.

## Agente Zé Polvinho (Open Polvo Intelligence)

O fluxo **LangGraph** no Python segue o mesmo desenho que o antigo motor em Go: **analisador** (JSON com intent) → **router** (confiança abaixo de 0,4 → `geral`) → **especialistas** (LLM ou stubs). Os prompts vivem em `openpolvointeligence/src/openpolvointeligence/prompts/`. Modelos por defeito no Python: `OPENAI_MODEL` / `GOOGLE_MODEL` no `.env` do serviço.

A coluna `langgraph_thread_id` na BD mantém-se por compatibilidade; o valor é opaco, ex.: `go-local:{uuid da conversa}`.

### LangSmith (opcional)

Pode definir `LANGCHAIN_API_KEY` / `LANGSMITH_API_KEY` no **serviço Python**; não é necessário para o chat funcionar.

## Migrações

| Versão | Descrição |
|--------|-----------|
| 000001 | Criar tabela `laele_users` |
| 000002 | Criar tabela `laele_conversations` |
| 000003 | Criar tabela `laele_messages` |
| 000004 | Adicionar `deleted_at` e `pinned_at` a `laele_conversations` |
| 000005 | Criar tabela `laele_workflows` |
| 000006 | Criar tabela `laele_workflow_runs` |
| 000009 | Colunas de agendamento (`schedule_*`) em `laele_workflows` |
| 000010 | Tabela `laele_user_smtp_settings` (SMTP por utilizador; password encriptada no servidor) |
| 000011 | Tabela `laele_user_contacts` (agenda: nome, telefone, email por utilizador) |

## Front-end

O cliente em [openpolvo](../openpolvo/) chama a API em **`http://127.0.0.1:8080`** por defeito (ou a URL em `VITE_API_BASE_URL`). O Vite faz **proxy** de `/v1`, `/health`, `/healthz`, `/ready` e `/readyz` para o mesmo host da API em dev/preview. Com **Electron**, podes usar **`OPEN_LA_ELE_API_URL`**. O backend aceita origem `null` com `CORS_ALLOW_NULL_ORIGIN=true` (ficheiro local). Na **versão web**, o painel de plugins mostra um convite a instalar a desktop: define `VITE_DESKTOP_DOWNLOAD_URL` no build do front (instalador ou página de releases; ver `openpolvo/.env.example`).

### Funcionalidades do front-end

- **Sidebar de conversas:** lista conversas fixadas (topo) e recentes; cada conversa tem menu de contexto (ícone `⋯`) com opções:
  - **Renomear** — edita o título inline
  - **Fixar / Desafixar** — fixa ou remove da secção fixados
  - **Excluir** — soft delete (não recuperável pela UI)
- **Chat:** usa a API Go + serviço Intelligence (OpenAI / Gemini por mensagem)
- **Electron:** janela desktop com IPC bridge; `OPEN_LA_ELE_API_URL` sobrepõe a URL da API
- **Correio (SMTP):** rota `/settings/email` — configurar servidor e remetente; o agente recebe metadados (sem password) para alinhar respostas sobre e-mail; envio real via `POST /v1/email/send` ou integrações futuras
- **Contactos:** rota `/settings/contacts` (menu «Contactos» no início); a agenda é enviada ao Intelligence (`contacts_context`) para o chat sugerir destinatários; no Pulo do Gato o nó **`send_email`** usa `contact_id` + SMTP

### SMTP por utilizador (backend)

A password SMTP é guardada encriptada (AES-GCM). Opcionalmente define `SMTP_CREDENTIALS_KEY` (32 bytes em base64) no `.env`; se estiver vazio, deriva-se uma chave a partir de `JWT_SECRET` (menos ideal em rotação de JWT). Ver [`.env.example`](.env.example).

## Automação (Pulo do Gato / Playwright-Go)

A API inclui workflows com grafo (nós `schedule`, `goto`, `click`, `fill`, `wait`, `llm`, **`send_email`**) executados com **[playwright-go](https://github.com/playwright-community/playwright-go)** (Chromium headless por defeito). O nó **`send_email`** não usa o browser: envia e-mail via SMTP do utilizador (`data.contact_id`, `data.email_subject`, `data.email_body`). O nó **`schedule`** define expressão **cron** (5 campos) e fuso IANA; o processo da API corre um **scheduler** com [robfig/cron](https://github.com/robfig/cron) e dispara `POST` interno equivalente a `POST /v1/workflows/{id}/run` quando o horário é atingido (sem necessidade de [Temporal.io](https://temporal.io) para o caso típico; Temporal continua uma opção para orquestração distribuída em grande escala). A geração de grafos (`POST /v1/workflows/generate`) e as chamadas dos nós `llm` durante o run usam o **mesmo serviço Open Polvo Intelligence** (não há LLM embutido no processo Go).

1. **Instalar browsers Playwright** (obrigatório antes de `POST .../workflows/{id}/run`; uma vez por máquina):

   ```bash
   go run github.com/playwright-community/playwright-go/cmd/playwright@v0.5700.1 install chromium
   ```

   A versão `@v0.5700.1` deve coincidir com a do `go.mod`. Os binários ficam em `%LOCALAPPDATA%\ms-playwright` (Windows) ou equivalente. Sem isto, o erro é `please install the driver (v1.57.0) first`.

2. **Variáveis de ambiente** (opcional): ver [`.env.example`](.env.example) — `AUTOMATION_ENABLED`, `AUTOMATION_HEADLESS`, `AUTOMATION_ALLOWED_HOSTS`, `WORKFLOW_SCHEDULER_ENABLED`, `WORKFLOW_SCHEDULER_INTERVAL`.

3. **Endpoints** (JWT): `GET/POST/PATCH/DELETE /v1/workflows`, `POST /v1/workflows/generate`, `POST /v1/workflows/{id}/run`, `GET /v1/workflows/{id}/runs`.

## Licença

MIT — ver [LICENSE](LICENSE).
