# Kit arquitectónico: `fullstack_next`

Stack profissional moderna: **Next.js 15 (App Router) + shadcn + Tailwind + Prisma + PostgreSQL**. Para SaaS "a sério" — server components, server actions, autenticação, DB relacional.

## File tree obrigatório

```
(root)/
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx                # HTML shell + <Providers>
│   │   ├── page.tsx                  # landing / home
│   │   ├── globals.css               # tokens OKLCH + Tailwind
│   │   ├── (app)/                    # grupo autenticado
│   │   │   ├── layout.tsx            # shell + nav
│   │   │   └── {feature}/page.tsx
│   │   └── api/
│   │       └── {feature}/route.ts    # handlers REST
│   ├── components/
│   │   ├── ui/                       # shadcn inline
│   │   └── {feature}/                # Server + Client components
│   ├── lib/
│   │   ├── db.ts                     # prisma client singleton
│   │   ├── utils.ts                  # cn()
│   │   └── auth.ts                   # se aplicável (stub)
│   └── actions/
│       └── {feature}.ts              # "use server" — server actions
└── .env.example
```

## `package.json`

```json
{
  "name": "app",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "next": "^15.0.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@prisma/client": "^5.22.0",
    "zod": "^3.23.8",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@fontsource-variable/geist": "^5.1.0",
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "prisma": "^5.22.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

## Server Actions (`src/actions/{feature}.ts`)

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

const CreateTaskSchema = z.object({ title: z.string().min(1).max(512) });

export async function createTask(formData: FormData) {
  const parsed = CreateTaskSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) return { error: parsed.error.flatten() };
  await db.task.create({ data: { title: parsed.data.title } });
  revalidatePath("/tasks");
  return { ok: true };
}
```

## Prisma (`prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Task {
  id        String   @id @default(cuid())
  title     String
  done      Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## `src/lib/db.ts`

```ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const db = globalThis.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__prisma = db;
```

## Padrões

- **Server Components por defeito**; adicionar `"use client"` só quando é preciso interactividade (forms com state, eventos, hooks do React).
- **Data fetching directo no server component** usando `db.task.findMany()` — sem `useEffect + fetch`.
- **Mutations via Server Actions** (`"use server"`) ou `route handlers` REST para clientes externos.
- **Forms**: `<form action={createTask}>` com inputs HTML nativos + componente `Button` shadcn.
- **Auth**: se necessário, deixar placeholder `src/lib/auth.ts` com comentário para integrar Auth.js ou Clerk (não implementar neste kit — demasiado pesado).
- **Env vars**: `DATABASE_URL` em `.env`, sempre `.env.example` no repo.

## Regras

- Usar **exclusivamente** App Router (`src/app/`), nunca `pages/`.
- Tailwind 4 com `@import "tailwindcss"` em `globals.css` e tokens OKLCH do kit shadcn.
- Nenhum uso de `getServerSideProps` ou APIs de Pages Router.
- Revalidação com `revalidatePath` nas server actions; para listas em tempo-real use `router.refresh()` no client.
