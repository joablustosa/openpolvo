# 🐙 Open Polvo — O maior agente pessoal de IA do mundo

> **Missão:** Ser o agente de IA pessoal mais completo do planeta — superando os gringos na nossa língua, com a nossa cultura e jeito brasileiro de fazer as coisas.

O Open Polvo é uma plataforma open source de agente pessoal com IA que roda 100 % localmente ou na nuvem. O agente **Zé Polvinho** entende contexto real do utilizador — tarefas, finanças, e-mails, redes sociais, automações agendadas — e age. Não é só um chatbot: é um verdadeiro assistente pessoal que executa.

```
openpolvo/            → Frontend React + Electron (desktop/web)
openpolvobackend/     → API Go — auth, conversas, dados, orquestração
openpolvointeligence/ → Agente Python — LangGraph, LLMs, especialistas
```

---

## ⚡ Início rápido — menos de 2 minutos

> Precisas de: **Go 1.24+**, **Node 20+**, **Python 3.11+** e pelo menos uma chave de API (**OpenAI** ou **Google Gemini**) no serviço Python (ou perfis LLM no SQLite via API). A API Go usa **SQLite local** (`DB_PATH`).

Abre **3 terminais** e executa cada bloco num:

### Terminal 1 — API Go (backend)

```bash
git clone https://github.com/open-polvo/open-polvo.git
cd open-polvo/openpolvobackend

cp .env.example .env
# Edita .env: JWT_SECRET, DB_PATH (SQLite), POLVO_INTELLIGENCE_INTERNAL_KEY (= POLVO_INTERNAL_KEY no Python)
#   JWT_SECRET=um-segredo-longo-aqui
#   DB_PATH=openpolvo.db
#   RUN_MIGRATIONS=true

go run ./cmd/openlaele-api/
# ✅ API em HTTP_ADDR (por defeito http://127.0.0.1:8080)
```

### Terminal 2 — Agente Python (Intelligence)

```bash
cd open-polvo/openpolvointeligence

cp .env.example .env
# Edita .env: preenche OPENAI_API_KEY e/ou GOOGLE_API_KEY
# e POLVO_INTERNAL_KEY=chave-secreta-igual-ao-Go

python -m venv .venv
source .venv/bin/activate   # Linux/Mac
# .venv\Scripts\activate    # Windows

pip install -e ".[dev]"
python -m openpolvointeligence.main
# ✅ Agente em http://127.0.0.1:8090
```

### Terminal 3 — Frontend (web/desktop)

```bash
cd open-polvo/openpolvo

npm install
npm run dev
# ✅ Desktop: Electron + Vite (também em http://localhost:5173)
```

Em **desktop** o `npm run dev` abre o **Electron**; em **navegador** usa `npm run dev:web` no `openpolvo`. Entra com o utilizador definido em `openpolvobackend/.env` (por defeito no `.env.example`: **email** `admin@openlaele.local` e **password** `DEFAULT_ADMIN_PASSWORD`; altera antes do primeiro arranque em produção).

> **Pronto. Em menos de 2 minutos, o Zé Polvinho tá de pé.**

---

## 🗺️ Configuração mínima (.env)

### `openpolvobackend/.env`

```env
HTTP_ADDR=:8080
JWT_SECRET=troca-isso-por-um-segredo-forte
DB_PATH=openpolvo.db
RUN_MIGRATIONS=true
BOOTSTRAP_DEFAULT_ADMIN=true
DEFAULT_ADMIN_EMAIL=admin@openlaele.local
DEFAULT_ADMIN_PASSWORD=uma-password-forte-so-local
POLVO_INTELLIGENCE_BASE_URL=http://127.0.0.1:8090
POLVO_INTELLIGENCE_INTERNAL_KEY=mesma-chave-do-python
```

### `openpolvointeligence/.env`

```env
OPENAI_API_KEY=sk-...          # OpenAI OU Google abaixo
# GOOGLE_API_KEY=AIza...
POLVO_INTERNAL_KEY=mesma-chave-do-go
HOST=127.0.0.1
PORT=8090
```

Ver `.env.example` de cada serviço para todas as opções (SMTP, Meta/WhatsApp/Instagram, automações, etc.).

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Electron)               │
│  Chat · Tarefas · Finanças · Social · Automações · Builder  │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / SSE streaming
┌──────────────────────▼──────────────────────────────────────┐
│              API Go — Hexagonal + DDD                        │
│  Auth JWT · Conversas · SMTP · Contactos · Tarefas          │
│  Finanças · Meta API · Automações agendadas · Playwright     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP interno (POLVO_INTELLIGENCE_*)
┌──────────────────────▼──────────────────────────────────────┐
│         Agente Python — LangGraph + FastAPI                  │
│  Zé Polvinho · Analisador de intenção · Especialistas        │
│  Email · Tarefas · Finanças · Social · Agendamento · Builder │
└─────────────────────────────────────────────────────────────┘
               ↕ OpenAI / Google Gemini
```

---

## 🤝 Guia de Contribuição

### A missão é grande. Vem junto.

O Open Polvo nasceu no Brasil para o mundo. A nossa meta é construir o agente pessoal de IA mais poderoso que existe — open source, em português, com alma brasileira. Para isso acontecer precisamos de cada desenvolvedor que topar o desafio.

---

### 📜 Regras da Comunidade

1. **Respeito acima de tudo.** Crítica ao código é saudável. Crítica à pessoa, não.
2. **Português é bem-vindo. Inglês também.** Issues, PRs e discussões podem ser em qualquer um dos dois — ou nos dois.
3. **Zero tolerância** a discriminação de qualquer tipo.
4. **Quem manda é o código que funciona.** Não importa se és júnior ou sênior: se o código é bom, é bom.
5. **Documente o que fizer.** Uma feature sem doc é uma feature pela metade.
6. **Errou? Aprende e segue.** Não existe "eu não sei" — existe "ainda não sei".
7. **O Zé Polvinho é nosso.** Cuida dele como se fosse o teu próprio assistente.

---

### 🛠️ Como contribuir

#### 1. Fork e clone

```bash
git clone https://github.com/SEU-USUARIO/open-polvo.git
cd open-polvo
git checkout -b feat/nome-da-sua-feature
```

#### 2. Configura o ambiente (ver Início Rápido acima)

#### 3. Faz as tuas alterações com testes

```bash
# Go
cd openpolvobackend && go test ./...

# Python
cd openpolvointeligence && pytest

# Frontend
cd openpolvo && npm run build
```

#### 4. Abre um Pull Request

---

### 🗣️ A Lei das Girias — Nomeação de Features

> **Esta é a regra mais importante do Open Polvo e também a mais divertida.**

Qualquer **nova funcionalidade** deve ter um nome que use pelo menos **uma gíria do estado brasileiro** de quem está contribuindo. Isso não é brincadeira — é política oficial do projeto.

**O nome vai aparecer em:**
- Nome do arquivo/módulo (ex.: `oxe_scheduler.go`)
- Nome da feature no CHANGELOG
- Branch do PR (ex.: `feat/uai-finance-widget`)

#### Mapa de girias por estado

| Estado | Gírias aceitas |
|--------|---------------|
| 🟡 **SP** — São Paulo | `mano`, `bagulho`, `vacilao`, `nave`, `firmeza` |
| 🟢 **RJ** — Rio de Janeiro | `mermao`, `mano`, `zoeira`, `baile`, `treta` |
| 🔴 **MG** — Minas Gerais | `uai`, `trem`, `so`, `oceis`, `saudade` |
| 🔵 **RS** — Rio Grande do Sul | `bah`, `tche`, `pia`, `guri`, `tri` |
| 🟠 **BA** — Bahia | `oxe`, `arretado`, `marvada`, `cabra`, `mainha` |
| 🟣 **PE** — Pernambuco | `vixe`, `arretado`, `cabra`, `oxente`, `mainha` |
| 🟤 **CE** — Ceará | `eita`, `caba`, `egua`, `fulano`, `visse` |
| 🟡 **AM** — Amazonas | `carai`, `caboco`, `manin`, `pira` |
| 🟢 **PA** — Pará | `ta bom`, `uhu`, `manito`, `aruera` |
| 🔴 **PR** — Paraná | `bah`, `capaz`, `nois`, `tchê` |
| 🔵 **SC** — Santa Catarina | `bah`, `baita`, `namorido`, `tri` |
| 🟠 **GO** — Goiás | `sô`, `um trem`, `vei`, `afe` |
| 🟣 **MT/MS** — Mato Grosso | `fia`, `trem`, `cuiabano`, `peão` |
| 🌎 **Fora do Brasil** | Qualquer gíria de português europeu, africano ou a palavra `gringo` como prefixo |

#### Exemplos de nomes válidos

```
feat/uai-scheduled-tasks      → dev de MG criando automações agendadas
feat/oxe-instagram-publisher  → dev da BA publicando posts
feat/bah-finance-dashboard    → dev do RS criando painel de finanças
feat/mermao-chat-streaming    → dev do RJ melhorando o streaming do chat
feat/eita-builder-preview     → dev do CE melhorando o preview do Builder
feat/vixe-email-templates     → dev de PE criando templates de e-mail
feat/bagulho-voice-input      → dev de SP adicionando entrada de voz
feat/gringo-openai-streaming  → dev de fora do Brasil
```

> Se não sabes de onde é o dev, usa a gíria do estado onde o PR foi mergeado — e o revisor tá autorizado a sugerir uma gíria melhor nos comentários.

---

### 📋 Template de Pull Request

Ao abrir um PR, usa este template:

```markdown
## O que esse PR faz? (explica como se fosse pro Zé Polvinho)
<!-- Descreve o que muda e por quê -->

## Tipo de mudança
- [ ] Bug fix (não quebra nada existente)
- [ ] Nova feature (não quebra nada existente)
- [ ] Breaking change (quebra algo existente)
- [ ] Documentação

## Gíria usada e estado de origem
<!-- Ex.: "uai" — Minas Gerais -->

## Como testar
<!-- Passo a passo para revisar e validar -->

## Checklist
- [ ] Código funciona localmente
- [ ] Testes passando (`go test ./...` / `pytest` / `npm run build`)
- [ ] Não commitei `.env` nem segredos
- [ ] Documentação atualizada (se aplicável)
- [ ] Nome da feature usa gíria regional
```

---

### 🚀 Roadmap e como entrar

Olha as issues abertas com as labels:

| Label | Significado |
|-------|-------------|
| `bom-primeiro-pr` | Ótimo para quem tá chegando agora |
| `precisa-de-ajuda` | Temos o problema, precisamos de quem bote a mão |
| `missao-critica` | Features que definem se a gente supera os gringos |
| `gringos-ja-tem` | Paridade com ferramentas internacionais |
| `so-nos-temos` | Features exclusivas do Open Polvo |

---

## 🧱 Estrutura do projeto

### Backend (Go) — arquitetura hexagonal

```
openpolvobackend/
├── cmd/openlaele-api/    → entrypoint, wiring de dependências
├── internal/
│   ├── agent/            → ports + adapter para o serviço Python
│   ├── auth/             → JWT, login, registro
│   ├── conversations/    → domínio de conversas + mensagens
│   ├── workflows/        → automações Playwright (Pulo do Gato)
│   ├── scheduledtasks/   → automações agendadas (CRON nativo)
│   ├── finance/          → finanças pessoais
│   ├── meta/             → WhatsApp, Facebook, Instagram
│   ├── social/           → automação de posts sociais
│   ├── transport/http/   → handlers e router Chi
│   └── platform/         → config, SQLite, migrations
└── migrations/           → arquivos SQL versionados
```

### Agente Python — LangGraph

```
openpolvointeligence/src/openpolvointeligence/
├── graphs/
│   ├── zepolvinho_graph.py   → grafo principal (analisador → especialista)
│   ├── builder_subgraph.py   → sub-grafo Builder (Lovable-like)
│   ├── *_metadata.py         → extratores de operações do chat
│   └── models.py             → OpenAI / Gemini
└── prompts/
    ├── analyzer_system.md    → classificador de intenções
    └── specialist_*.md       → 20+ especialistas por domínio
```

### Frontend — React + Electron

```
openpolvo/src/
├── pages/
│   ├── Main/             → chat principal + painéis
│   ├── Financas/         → painel de finanças pessoais
│   ├── Automacoes/       → automações agendadas
│   ├── Social/           → automação de redes sociais
│   └── Settings/         → plugins (SMTP, Meta, WhatsApp...)
├── core/                 → contextos, sidebar, workspace
└── lib/                  → API clients (scheduleApi, metaApi...)
```

---

## 🌐 Capacidades do Zé Polvinho

| Domínio | O que ele faz |
|---------|---------------|
| 💬 **Chat** | Conversa com contexto completo do utilizador |
| 📧 **E-mail** | Redige, envia e monitora via SMTP próprio |
| ✅ **Tarefas** | Cria, organiza e executa listas com o agente |
| 💰 **Finanças** | Gastos, receitas, categorias, assinaturas |
| ⏰ **Automações** | CRON nativo: "todo dia às 20h, envia resumo por email" |
| 📱 **Redes Sociais** | Posts para Instagram, Facebook, LinkedIn, X |
| 🤖 **Builder** | Gera apps React/fullstack completas com preview |
| 🌐 **Pulo do Gato** | Automação web com Playwright (RPA) |
| 📊 **Dashboards** | Gráficos gerados dinamicamente pelo agente |
| 🎙️ **Voz** | Transcrição (Whisper / Gemini) |
| 🔔 **WhatsApp** | Envia e recebe mensagens via Meta API |

---

## 🔧 Funcionalidades avançadas

### Automações agendadas (CRON nativo)

Diga para o Zé Polvinho no chat: *"Envia um email de resumo de tudo que fiz hoje todo dia às 20h"* — ele cria a automação automaticamente. Ou gerencie em `/automacoes`.

```env
# Ativar o runner (padrão: true)
SCHED_TASKS_ENABLED=true
SCHED_TASKS_INTERVAL=1m
```

### Playwright / Pulo do Gato (RPA)

```bash
# Uma vez por máquina (antes do primeiro run de workflow)
go run github.com/playwright-community/playwright-go/cmd/playwright@v0.5700.1 install chromium
```

### Builder (apps geradas por IA)

Diga: *"Faz um kanban em React com drag and drop"* — o Builder gera o projeto completo com preview ao vivo usando WebContainer no browser.

### Meta API (WhatsApp, Instagram, Facebook)

Configure em `/settings/plugins` → tokens Meta. Webhook: `GET/POST /meta/webhook`.

```env
META_WEBHOOK_VERIFY_TOKEN=token-configurado-no-painel-meta
```

---

## 📦 Migrações do banco

As migrações rodam automaticamente com `RUN_MIGRATIONS=true`. Para rodar manualmente:

```bash
# Aplicar todas (arranque normal com RUN_MIGRATIONS=true no .env)
go run ./cmd/openlaele-api/

# Verificar estado
go run github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
  -database "sqlite3://openpolvo.db" -path migrations version
```

### Primeiro arranque (utilizador inicial)

- Com `BOOTSTRAP_DEFAULT_ADMIN=true` (defeito), **é obrigatório** definir `DEFAULT_ADMIN_PASSWORD` no `.env`. A API **termina com erro** se a password estiver vazia — não há utilizador inicial sem password explícita (política de segurança).
- O bootstrap corre **depois** das migrações e é **idempotente**: se já existir utilizador com `DEFAULT_ADMIN_EMAIL`, não cria duplicado.

### Domínios da API ↔ migrações SQLite (inventário)

Todas as áreas abaixo usam o mesmo ficheiro SQLite (`DB_PATH`) e repositórios registados em `cmd/openlaele-api/main.go`. Cada domínio depende das migrações indicadas.

| Domínio | Migrações principais (pasta `migrations/`) |
|---------|-----------------------------------------------|
| Identidade (login/registo) | `000001_create_users` |
| Conversas e mensagens | `000002`, `000003`, `000004` |
| Workflows (Pulo do Gato) | `000005`, `000006`, `000007`, `000008`, `000009` |
| SMTP e opções de chat | `000010`, `000012` |
| Contactos | `000011` |
| Listas de tarefas | `000013`, `000014`; prazo `due_at` em `000015` |
| Finanças, digest diário | `000015` (categorias, movimentos, assinaturas, definições de digest) |
| Meta (WhatsApp/FB/IG) | `000016` |
| Social / publicações | `000017` |
| Tarefas agendadas (CRON) | `000018` |
| Perfis LLM | `000019` |

Se adicionares um novo domínio na API, adiciona migração `.up.sql` / `.down.sql` e regista o repositório em `main.go` para não haver handlers sem tabela.

---

## 🐳 Docker (em breve)

`docker-compose.yml` está no roadmap (`missao-critica`). Contribuições são muito bem-vindas!

---

## 📄 Licença

MIT — ver [LICENSE](LICENSE).

Este projeto é livre para uso pessoal e comercial. A única coisa que pedimos: **se o Zé Polvinho te ajudou, manda um PR de volta.**

---

<div align="center">

**Feito no Brasil 🇧🇷 para o mundo 🌍**

*"Mano, a gente vai superar os gringos. Pode apostar."*

[Issues](https://github.com/open-polvo/open-polvo/issues) · [Discussions](https://github.com/open-polvo/open-polvo/discussions) · [Roadmap](https://github.com/open-polvo/open-polvo/projects)

</div>
