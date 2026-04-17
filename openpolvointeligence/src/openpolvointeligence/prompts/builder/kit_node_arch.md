# Kit arquitectónico: `fullstack_node`

Monorepo leve: React (web) + Hono (api) + Drizzle/SQLite. Corre localmente com dois `npm run dev`.

## File tree obrigatório

```
(root)/
├── package.json                       # workspaces: apps/*, packages/*
├── README.md
├── apps/
│   ├── web/                           # estrutura idêntica ao kit_frontend_arch
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/...
│   └── api/
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts               # bootstrap Hono + port
│           ├── routes/
│           │   └── {feature}.ts       # um ficheiro por recurso
│           ├── services/
│           │   └── {feature}Service.ts
│           ├── repos/
│           │   └── {feature}Repo.ts
│           └── db/
│               ├── client.ts          # drizzle(betterSqlite3("data.sqlite"))
│               └── schema.ts          # tabelas Drizzle
└── packages/
    └── shared/
        ├── package.json
        └── src/
            └── types.ts               # DTOs partilhados web ↔ api
```

## `package.json` (root)

```json
{
  "name": "monorepo",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm-run-all -p dev:*",
    "dev:web": "npm --workspace apps/web run dev",
    "dev:api": "npm --workspace apps/api run dev"
  },
  "devDependencies": { "npm-run-all": "^4.1.5" }
}
```

## `apps/api/package.json`

```json
{
  "name": "api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -b",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "hono": "^4.6.12",
    "@hono/node-server": "^1.13.7",
    "drizzle-orm": "^0.36.4",
    "better-sqlite3": "^11.5.0",
    "zod": "^3.23.8",
    "shared": "workspace:*"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.9.0",
    "drizzle-kit": "^0.28.1",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

## `apps/api/src/index.ts`

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { tasksRoutes } from "./routes/tasks";

const app = new Hono();
app.use("*", cors());
app.get("/health", (c) => c.text("ok"));
app.route("/api/tasks", tasksRoutes);

serve({ fetch: app.fetch, port: 8787 });
console.log("API on http://localhost:8787");
```

## Camadas

- **routes**: handlers Hono. Validação Zod do body/params, delega para service, devolve JSON.
- **services**: lógica de negócio (IDs, regras, erros). Não toca directamente na DB.
- **repos**: acesso exclusivo ao Drizzle. Funções puras `get`, `list`, `create`, `update`, `remove`.
- **db/schema.ts**: Drizzle tables. `db/client.ts` cria o driver.

## `packages/shared/src/types.ts`

```ts
export type Task = { id: string; title: string; done: boolean; createdAt: string };
export type CreateTaskInput = { title: string };
```

Web importa `import type { Task } from "shared";`.

## README

Deve ter:
```md
## Requisitos
- Node 20+
- npm 10+

## Como correr
\`\`\`bash
npm install
npm --workspace apps/api run db:push
npm run dev   # arranca web (5173) + api (8787)
\`\`\`

## Endpoints
- GET /api/tasks
- POST /api/tasks
- ...
```
