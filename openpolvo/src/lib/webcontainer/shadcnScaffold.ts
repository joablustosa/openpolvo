import type { VirtualProjectFiles } from "./types";
import { buildPreviewConsoleRelaySnippet } from "@/lib/devStudio/previewConsoleRelay";

import appShellRaw from "./scaffold/layout/AppShell.tsx?raw";
import navbarRaw from "./scaffold/layout/Navbar.tsx?raw";
import sidebarRaw from "./scaffold/layout/Sidebar.tsx?raw";
import utilsRaw from "./scaffold/utils.ts?raw";
import badgeRaw from "./scaffold/ui/badge.tsx?raw";
import buttonRaw from "./scaffold/ui/button.tsx?raw";
import cardRaw from "./scaffold/ui/card.tsx?raw";
import dialogRaw from "./scaffold/ui/dialog.tsx?raw";
import inputRaw from "./scaffold/ui/input.tsx?raw";
import labelRaw from "./scaffold/ui/label.tsx?raw";
import selectRaw from "./scaffold/ui/select.tsx?raw";
import separatorRaw from "./scaffold/ui/separator.tsx?raw";
import tableRaw from "./scaffold/ui/table.tsx?raw";

export type DesignTokens = {
  palette_base?: string;
  border_radius?: string;
  accent?: string;
  mode?: string;
  layout_shell?: string;
  /**
   * Overrides crus de CSS variables (ex.: `--primary`, `--radius`) vindos do
   * `dev_workflow.style_guide.tokens` — injectados em `:root` para um visual
   * por solicitação, mantendo a stack shadcn/Tailwind.
   */
  css_vars?: Record<string, string>;
};

const ACCENT_PRIMARY: Record<string, string> = {
  blue: "oklch(0.488 0.243 264.376)",
  violet: "oklch(0.541 0.281 293.009)",
  emerald: "oklch(0.596 0.145 163.225)",
  orange: "oklch(0.646 0.222 41.116)",
  rose: "oklch(0.586 0.253 17.585)",
  cyan: "oklch(0.52 0.105 223.128)",
};

const RADIUS: Record<string, string> = {
  sm: "0.375rem",
  md: "0.625rem",
  lg: "0.875rem",
};

const PALETTE_MUTED: Record<string, { light: string; dark: string }> = {
  zinc: {
    light: "oklch(0.967 0.001 286.375)",
    dark: "oklch(0.274 0.006 286.033)",
  },
  slate: {
    light: "oklch(0.968 0.007 247.896)",
    dark: "oklch(0.279 0.041 260.031)",
  },
  neutral: {
    light: "oklch(0.97 0 0)",
    dark: "oklch(0.269 0 0)",
  },
};

/** Apenas nomes de CSS vars conhecidos do tema shadcn (evita injecção arbitrária). */
const ALLOWED_CSS_VARS = new Set([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "radius",
]);

/** Valor CSS seguro: cor/oklch/hsl/var/número/rem — sem `;`, `{}` ou `@`. */
function isSafeCssValue(value: string): boolean {
  return value.length <= 80 && /^[a-zA-Z0-9 .,%()#/\-]+$/.test(value);
}

function sanitizeCssVars(
  raw?: Record<string, string>,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const name = k.replace(/^--/, "").trim();
    const value = (v ?? "").trim();
    if (ALLOWED_CSS_VARS.has(name) && value && isSafeCssValue(value)) {
      out[name] = value;
    }
  }
  return out;
}

function normalizeTokens(tokens?: Partial<DesignTokens>): Required<DesignTokens> {
  const palette = tokens?.palette_base ?? "zinc";
  const base = ["zinc", "slate", "neutral"].includes(palette) ? palette : "zinc";
  const radius = tokens?.border_radius ?? "md";
  const r = ["sm", "md", "lg"].includes(radius) ? radius : "md";
  const accent = tokens?.accent ?? "blue";
  const a = accent in ACCENT_PRIMARY ? accent : "blue";
  const mode = tokens?.mode === "dark" ? "dark" : "light";
  const shell = tokens?.layout_shell === "dashboard" ? "dashboard" : "marketing";
  return {
    palette_base: base,
    border_radius: r,
    accent: a,
    mode,
    layout_shell: shell,
    css_vars: sanitizeCssVars(tokens?.css_vars),
  };
}

/** CSS global com tokens shadcn; accent e radius injectados pelo Architect. */
export function buildIndexCss(tokens?: Partial<DesignTokens>): string {
  const t = normalizeTokens(tokens);
  const primary = ACCENT_PRIMARY[t.accent] ?? ACCENT_PRIMARY.blue;
  const radius = RADIUS[t.border_radius] ?? RADIUS.md;
  const muted = PALETTE_MUTED[t.palette_base] ?? PALETTE_MUTED.zinc;
  const darkClass = t.mode === "dark" ? ' class="dark"' : "";
  const overrides = Object.entries(t.css_vars)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
  const rootOverrides = overrides ? `\n${overrides}` : "";

  return `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: ${primary};
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: ${muted.light};
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: ${radius};${rootOverrides}
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: ${primary};
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: ${muted.dark};
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);${rootOverrides}
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html${darkClass} {
    @apply h-full min-h-dvh font-sans antialiased;
  }
  body {
    @apply m-0 h-full min-h-dvh w-full overflow-x-hidden bg-background text-foreground;
  }
  #root {
    @apply flex min-h-dvh w-full flex-col;
  }
}
`;
}

const PACKAGE_JSON = {
  name: "open-polvo-preview",
  private: true,
  type: "module",
  scripts: {
    dev: "vite",
    "dev:api": "tsx watch server/index.ts",
    build: "vite build",
    preview: "vite preview",
    "db:push": "drizzle-kit push",
  },
  dependencies: {
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "@base-ui/react": "^1.4.0",
    "class-variance-authority": "^0.7.1",
    clsx: "^2.1.1",
    "lucide-react": "^1.8.0",
    "tailwind-merge": "^3.5.0",
    hono: "^4.6.12",
    "@hono/node-server": "^1.13.7",
    "@electric-sql/pglite": "^0.2.17",
    "drizzle-orm": "^0.36.4",
  },
  devDependencies: {
    vite: "^5.4.10",
    "@vitejs/plugin-react": "^4.3.3",
    "@tailwindcss/vite": "^4.2.2",
    tailwindcss: "^4.2.2",
    "tw-animate-css": "^1.4.0",
    typescript: "^5.6.3",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@types/node": "^22.10.0",
    tsx: "^4.19.2",
    "drizzle-kit": "^0.28.1",
  },
} as const;

const VITE_CONFIG = `import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Sobe o servidor Hono (server/index.ts) junto com o Vite dev. */
function apiServerPlugin(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "open-polvo-api-server",
    apply: "serve",
    configureServer() {
      if (child) return;
      child = spawn("npx", ["tsx", "watch", "server/index.ts"], {
        cwd: __dirname,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, PORT: "8787" },
      });
      const kill = () => {
        if (child) {
          child.kill();
          child = null;
        }
      };
      process.on("exit", kill);
      process.on("SIGINT", kill);
      process.on("SIGTERM", kill);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiServerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    hmr: { overlay: true },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
`;

const DEFAULT_APP = `import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route
          path="/"
          element={
            <section className="flex flex-1 flex-col items-center justify-center border-b border-border bg-background px-6 py-24">
              <div className="mx-auto max-w-xl text-center">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                  Open Polvo Preview
                </h1>
                <p className="mt-4 text-lg text-muted-foreground">
                  Pede uma alteração no chat — o site actualiza aqui ao vivo.
                </p>
              </div>
            </section>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
`;

const SERVER_INDEX = `import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { initDb } from "./db/client";
import { itemsRouter } from "./routes/items";

const app = new Hono();
app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true, service: "open-polvo-api" }));
app.route("/api/items", itemsRouter);

const port = Number(process.env.PORT || 8787);

async function main() {
  await initDb();
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(\`API a correr em http://127.0.0.1:\${port}\`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const SERVER_DB_CLIENT = `import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function initDb() {
  if (db) return db;
  const client = new PGlite(".data/pglite");
  db = drizzle(client, { schema });
  await client.exec(\`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  \`);
  return db;
}

export async function getDb() {
  if (!db) await initDb();
  return db!;
}
`;

const SERVER_DB_SCHEMA = `import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
`;

const SERVER_ITEMS_ROUTE = `import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { items } from "../db/schema";

export const itemsRouter = new Hono();

itemsRouter.get("/", async (c) => {
  const db = await getDb();
  const rows = await db.select().from(items).orderBy(items.createdAt);
  return c.json(rows);
});

itemsRouter.post("/", async (c) => {
  const body = await c.req.json<{ title?: string }>();
  const title = String(body?.title ?? "").trim();
  if (!title) return c.json({ error: "title required" }, 400);
  const db = await getDb();
  const [row] = await db.insert(items).values({ title }).returning();
  return c.json(row, 201);
});

itemsRouter.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json<{ done?: boolean; title?: string }>();
  const db = await getDb();
  const [row] = await db
    .update(items)
    .set({
      ...(typeof body.done === "boolean" ? { done: body.done } : {}),
      ...(typeof body.title === "string" ? { title: body.title.trim() } : {}),
    })
    .where(eq(items.id, id))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

itemsRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  const db = await getDb();
  await db.delete(items).where(eq(items.id, id));
  return c.json({ ok: true });
});
`;

const SRC_API_CLIENT = `export type ApiItem = {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(err || \`API \${res.status}\`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => apiFetch<{ ok: boolean }>("/api/health"),
  listItems: () => apiFetch<ApiItem[]>("/api/items"),
  createItem: (title: string) =>
    apiFetch<ApiItem>("/api/items", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  toggleItem: (id: number, done: boolean) =>
    apiFetch<ApiItem>(\`/api/items/\${id}\`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    }),
  deleteItem: (id: number) =>
    apiFetch<{ ok: boolean }>(\`/api/items/\${id}\`, { method: "DELETE" }),
};
`;

const DRIZZLE_CONFIG = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
`;

/** Stack Vite + React + Tailwind v4 + shadcn (preview Dev Studio). */
export function getShadcnViteScaffold(
  tokens?: Partial<DesignTokens>,
): VirtualProjectFiles {
  const t = normalizeTokens(tokens);

  const files: VirtualProjectFiles = {
    "package.json": JSON.stringify(PACKAGE_JSON, null, 2),
    "index.html": `<!DOCTYPE html>
<html lang="pt-BR"${t.mode === "dark" ? ' class="dark"' : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open Polvo Preview</title>
    ${buildPreviewConsoleRelaySnippet()}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "vite.config.ts": VITE_CONFIG,
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          useDefineForClassFields: true,
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          module: "ESNext",
          skipLibCheck: true,
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: "react-jsx",
          strict: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          noFallthroughCasesInSwitch: true,
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src"],
      },
      null,
      2,
    ),
    "tsconfig.node.json": JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          skipLibCheck: true,
          module: "ESNext",
          moduleResolution: "bundler",
          allowSyntheticDefaultImports: true,
        },
        include: ["vite.config.ts"],
      },
      null,
      2,
    ),
    "src/vite-env.d.ts": `/// <reference types="vite/client" />\n`,
    "src/main.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
`,
    "src/index.css": buildIndexCss(t),
    "src/lib/utils.ts": utilsRaw,
    "src/components/ui/button.tsx": buttonRaw,
    "src/components/ui/card.tsx": cardRaw,
    "src/components/ui/input.tsx": inputRaw,
    "src/components/ui/badge.tsx": badgeRaw,
    "src/components/ui/dialog.tsx": dialogRaw,
    "src/components/ui/select.tsx": selectRaw,
    "src/components/ui/separator.tsx": separatorRaw,
    "src/components/ui/label.tsx": labelRaw,
    "src/components/ui/table.tsx": tableRaw,
    "src/components/layout/AppShell.tsx": appShellRaw,
    "src/components/layout/Navbar.tsx": navbarRaw,
    "src/components/layout/Sidebar.tsx": sidebarRaw,
    "src/lib/api.ts": SRC_API_CLIENT,
    "server/index.ts": SERVER_INDEX,
    "server/db/client.ts": SERVER_DB_CLIENT,
    "server/db/schema.ts": SERVER_DB_SCHEMA,
    "server/routes/items.ts": SERVER_ITEMS_ROUTE,
    "drizzle.config.ts": DRIZZLE_CONFIG,
    "src/App.tsx": DEFAULT_APP,
  };

  return files;
}
