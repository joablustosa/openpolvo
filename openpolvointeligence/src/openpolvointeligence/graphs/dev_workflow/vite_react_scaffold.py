"""Scaffold Vite + React + Tailwind v4 + shadcn (padrão Dev Studio / mercado)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_SCAFFOLD_ROOT = Path(__file__).resolve().parent.parent.parent / "scaffold"
_LAYOUT_DIR = _SCAFFOLD_ROOT / "layout"
_UI_DIR = _SCAFFOLD_ROOT / "ui"

_ACCENT_PRIMARY: dict[str, str] = {
    "blue": "oklch(0.488 0.243 264.376)",
    "violet": "oklch(0.541 0.281 293.009)",
    "emerald": "oklch(0.596 0.145 163.225)",
    "orange": "oklch(0.646 0.222 41.116)",
    "rose": "oklch(0.586 0.253 17.585)",
    "cyan": "oklch(0.52 0.105 223.128)",
}

_RADIUS: dict[str, str] = {"sm": "0.375rem", "md": "0.625rem", "lg": "0.875rem"}

_PALETTE_MUTED: dict[str, dict[str, str]] = {
    "zinc": {"light": "oklch(0.967 0.001 286.375)", "dark": "oklch(0.274 0.006 286.033)"},
    "slate": {"light": "oklch(0.968 0.007 247.896)", "dark": "oklch(0.279 0.041 260.031)"},
    "neutral": {"light": "oklch(0.97 0 0)", "dark": "oklch(0.269 0 0)"},
}

_VITE_STACKS = frozenset({"vite-react", "fullstack-mixed"})


def _norm_path(path: str) -> str:
    return str(path or "").strip().replace("\\", "/").lstrip("/")


def _read_text(rel: str) -> str:
    path = _SCAFFOLD_ROOT / rel.replace("/", "\\") if "\\" not in rel else _SCAFFOLD_ROOT / rel
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _load_static_files() -> dict[str, str]:
    files: dict[str, str] = {}
    utils = _read_text("utils.ts")
    if utils:
        files["src/lib/utils.ts"] = utils
    for ui in _UI_DIR.glob("*.tsx"):
        files[f"src/components/ui/{ui.name}"] = ui.read_text(encoding="utf-8")
    for layout in _LAYOUT_DIR.glob("*.tsx"):
        files[f"src/components/layout/{layout.name}"] = layout.read_text(encoding="utf-8")
    return files


def _normalize_tokens(tokens: dict[str, Any] | None) -> dict[str, Any]:
    raw = tokens or {}
    palette = str(raw.get("palette_base") or "zinc")
    base = palette if palette in ("zinc", "slate", "neutral") else "zinc"
    radius = str(raw.get("border_radius") or "md")
    r = radius if radius in _RADIUS else "md"
    accent = str(raw.get("accent") or "blue")
    a = accent if accent in _ACCENT_PRIMARY else "blue"
    mode = "dark" if raw.get("mode") == "dark" else "light"
    shell = "dashboard" if raw.get("layout_shell") == "dashboard" else "marketing"
    return {
        "palette_base": base,
        "border_radius": r,
        "accent": a,
        "mode": mode,
        "layout_shell": shell,
    }


def build_index_css(tokens: dict[str, Any] | None = None) -> str:
    """CSS global shadcn + Tailwind v4 com tokens do Architect."""
    t = _normalize_tokens(tokens)
    primary = _ACCENT_PRIMARY[t["accent"]]
    radius = _RADIUS[t["border_radius"]]
    muted = _PALETTE_MUTED[t["palette_base"]]

    return f"""@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {{
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
}}

:root {{
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: {primary};
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: {muted["light"]};
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: {radius};
}}

.dark {{
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: {primary};
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: {muted["dark"]};
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}}

@layer base {{
  * {{
    @apply border-border outline-ring/50;
  }}
  body {{
    @apply bg-background text-foreground antialiased;
  }}
}}
"""


def _package_json(project_name: str, *, fullstack: bool) -> str:
    pkg: dict[str, Any] = {
        "name": project_name,
        "private": True,
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "vite build",
            "preview": "vite preview",
        },
        "dependencies": {
            "react": "^18.3.1",
            "react-dom": "^18.3.1",
            "react-router-dom": "^6.28.0",
            "@base-ui/react": "^1.4.0",
            "class-variance-authority": "^0.7.1",
            "clsx": "^2.1.1",
            "lucide-react": "^1.8.0",
            "tailwind-merge": "^3.5.0",
        },
        "devDependencies": {
            "vite": "^5.4.10",
            "@vitejs/plugin-react": "^4.3.3",
            "@tailwindcss/vite": "^4.2.2",
            "tailwindcss": "^4.2.2",
            "tw-animate-css": "^1.4.0",
            "typescript": "^5.6.3",
            "@types/react": "^18.3.12",
            "@types/react-dom": "^18.3.1",
            "@types/node": "^22.10.0",
        },
    }
    if fullstack:
        pkg["scripts"]["dev:api"] = "tsx watch server/index.ts"
        pkg["scripts"]["db:push"] = "drizzle-kit push"
        pkg["dependencies"].update(
            {
                "hono": "^4.6.12",
                "@hono/node-server": "^1.13.7",
                "@electric-sql/pglite": "^0.2.17",
                "drizzle-orm": "^0.36.4",
            },
        )
        pkg["devDependencies"].update({"tsx": "^4.19.2", "drizzle-kit": "^0.28.1"})
    return json.dumps(pkg, indent=2, ensure_ascii=False) + "\n"


def _prefix_paths(files: dict[str, str], prefix: str) -> dict[str, str]:
    if not prefix:
        return dict(files)
    norm = prefix.strip("/").replace("\\", "/")
    if norm:
        norm = norm + "/"
    return {f"{norm}{path}": content for path, content in files.items()}


def _external_api_client() -> str:
    return """export type ApiItem = {
  id: number
  title: string
  done: boolean
  createdAt: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const err = await res.text().catch(() => "")
    throw new Error(err || `API ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => apiFetch<{ ok: boolean }>("/api/health"),
  listItems: () => apiFetch<ApiItem[]>("/api/items"),
  createItem: (title: string) =>
    apiFetch<ApiItem>("/api/items", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
}
"""


def _vite_config(*, fullstack: bool, api_proxy_port: int | None = None) -> str:
    api_plugin = ""
    proxy = ""
    proxy_port = api_proxy_port or (8787 if fullstack else None)
    if fullstack:
        api_plugin = """
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
"""
        proxy = f"""
    proxy: {{
      "/api": {{
        target: "http://127.0.0.1:{proxy_port}",
        changeOrigin: true,
      }},
    }},"""
    elif api_proxy_port:
        proxy = f"""
    proxy: {{
      "/api": {{
        target: "http://127.0.0.1:{api_proxy_port}",
        changeOrigin: true,
      }},
    }},"""

    imports = (
        'import { spawn, type ChildProcess } from "node:child_process";\n' if fullstack else ""
    )
    plugin_type = ", type Plugin" if fullstack else ""
    plugins = "[react(), tailwindcss()" + (", apiServerPlugin()" if fullstack else "") + "]"

    return f"""import path from "node:path";
import {{ fileURLToPath }} from "node:url";
{imports}import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {{ defineConfig{plugin_type} }} from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
{api_plugin}
export default defineConfig({{
  plugins: {plugins},
  resolve: {{
    alias: {{
      "@": path.resolve(__dirname, "src"),
    }},
  }},
  server: {{
    host: true,
    port: 5173,
    strictPort: false,
    hmr: {{ overlay: true }},{proxy}
  }},
}});
"""


def _page_component_name(path: str) -> str:
    stem = Path(path).stem
    return stem if stem[0].isupper() else "".join(p.capitalize() for p in re.split(r"[-_]", stem))


def build_app_tsx_from_pages(page_paths: list[str], *, show_sidebar: bool = False) -> str:
    """Gera App.tsx com rotas a partir de `src/pages/*.tsx` ou `frontend/src/pages/*.tsx`."""
    routes: list[str] = []
    imports: list[str] = []
    use_frontend = any(_norm_path(p).startswith("frontend/src/pages/") for p in page_paths)
    pages_prefix = "frontend/src/pages/" if use_frontend else "src/pages/"
    for idx, raw in enumerate(sorted(page_paths)):
        path = _norm_path(raw)
        if not path.startswith(pages_prefix) or not path.endswith(".tsx"):
            continue
        name = _page_component_name(path)
        imports.append(f'import {name} from "@/pages/{Path(path).stem}"')
        route_path = "/" if idx == 0 else f"/{Path(path).stem.lower().replace('_', '-')}"
        routes.append(f'        <Route path="{route_path}" element={{<{name} />}} />')
    if not routes:
        return _default_app_tsx(show_sidebar=show_sidebar)
    shell_prop = " showSidebar" if show_sidebar else ""
    return (
        'import { Navigate, Route, Routes } from "react-router-dom"\n'
        'import AppShell from "@/components/layout/AppShell"\n'
        + "\n".join(imports)
        + "\n\nexport default function App() {\n"
        + "  return (\n"
        + f"    <AppShell{shell_prop}>\n"
        + "      <Routes>\n"
        + "\n".join(routes)
        + '\n        <Route path="*" element={<Navigate to="/" replace />} />\n'
        + "      </Routes>\n"
        + "    </AppShell>\n"
        + "  )\n"
        + "}\n"
    )


def _default_app_tsx(*, show_sidebar: bool = False) -> str:
    shell_prop = " showSidebar" if show_sidebar else ""
    return f"""import {{ Navigate, Route, Routes }} from "react-router-dom"
import AppShell from "@/components/layout/AppShell"

export default function App() {{
  return (
    <AppShell{shell_prop}>
      <Routes>
        <Route
          path="/"
          element={{
            <section className="flex flex-1 flex-col items-center justify-center border-b border-border bg-background px-6 py-24">
              <div className="mx-auto max-w-xl text-center">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground">
                  Aplicação criada
                </h1>
                <p className="mt-4 text-lg text-muted-foreground">
                  Pede alterações no chat — o código actualiza no Explorer.
                </p>
              </div>
            </section>
          }}
        />
        <Route path="*" element={{<Navigate to="/" replace />}} />
      </Routes>
    </AppShell>
  )
}}
"""


def get_vite_react_scaffold_files(
    project_name: str,
    *,
    stack: str = "fullstack-mixed",
    design_tokens: dict[str, Any] | None = None,
    path_prefix: str = "",
    api_proxy_port: int | None = None,
) -> dict[str, str]:
    """Mapa path → conteúdo do repositório padrão (Vite + React + shadcn)."""
    if stack not in _VITE_STACKS:
        return {}
    fullstack = stack == "fullstack-mixed"
    external_api = api_proxy_port is not None and not fullstack
    t = _normalize_tokens(design_tokens)
    show_sidebar = t["layout_shell"] == "dashboard"
    dark_class = ' class="dark"' if t["mode"] == "dark" else ""

    files = _load_static_files()
    files.update(
        {
            "package.json": _package_json(project_name, fullstack=fullstack),
            "index.html": f"""<!DOCTYPE html>
<html lang="pt-BR"{dark_class}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{project_name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",
            "vite.config.ts": _vite_config(
                fullstack=fullstack,
                api_proxy_port=api_proxy_port if external_api else None,
            ),
            "tsconfig.json": json.dumps(
                {
                    "compilerOptions": {
                        "target": "ES2020",
                        "useDefineForClassFields": True,
                        "lib": ["ES2020", "DOM", "DOM.Iterable"],
                        "module": "ESNext",
                        "skipLibCheck": True,
                        "moduleResolution": "bundler",
                        "resolveJsonModule": True,
                        "isolatedModules": True,
                        "noEmit": True,
                        "jsx": "react-jsx",
                        "strict": True,
                        "noUnusedLocals": False,
                        "noUnusedParameters": False,
                        "noFallthroughCasesInSwitch": True,
                        "baseUrl": ".",
                        "paths": {"@/*": ["./src/*"]},
                    },
                    "include": ["src"],
                },
                indent=2,
            )
            + "\n",
            "tsconfig.node.json": json.dumps(
                {
                    "compilerOptions": {
                        "composite": True,
                        "skipLibCheck": True,
                        "module": "ESNext",
                        "moduleResolution": "bundler",
                        "allowSyntheticDefaultImports": True,
                    },
                    "include": ["vite.config.ts"],
                },
                indent=2,
            )
            + "\n",
            "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
            "src/main.tsx": """import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
""",
            "src/index.css": build_index_css(design_tokens),
            "src/App.tsx": _default_app_tsx(show_sidebar=show_sidebar),
            ".gitignore": "node_modules\ndist\n.data\n.env\n*.log\n",
        },
    )

    if fullstack:
        files.update(_fullstack_server_files())
    elif external_api:
        files["src/lib/api.ts"] = _external_api_client()

    return _prefix_paths(files, path_prefix)


def _fullstack_server_files() -> dict[str, str]:
    return {
        "src/lib/api.ts": """export type ApiItem = {
  id: number
  title: string
  done: boolean
  createdAt: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const err = await res.text().catch(() => "")
    throw new Error(err || `API ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => apiFetch<{ ok: boolean }>("/api/health"),
  listItems: () => apiFetch<ApiItem[]>("/api/items"),
  createItem: (title: string) =>
    apiFetch<ApiItem>("/api/items", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
}
""",
        "server/index.ts": """import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { initDb } from "./db/client"
import { itemsRouter } from "./routes/items"

const app = new Hono()
app.use("*", cors())

app.get("/api/health", (c) => c.json({ ok: true, service: "open-polvo-api" }))
app.route("/api/items", itemsRouter)

const port = Number(process.env.PORT || 8787)

async function main() {
  await initDb()
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`API a correr em http://127.0.0.1:${port}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
""",
        "server/db/client.ts": """import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export async function initDb() {
  if (db) return db
  const client = new PGlite(".data/pglite")
  db = drizzle(client, { schema })
  await client.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  return db
}

export async function getDb() {
  if (!db) await initDb()
  return db!
}
""",
        "server/db/schema.ts": """import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Item = typeof items.$inferSelect
""",
        "server/routes/items.ts": """import { Hono } from "hono"
import { getDb } from "../db/client"
import { items } from "../db/schema"

export const itemsRouter = new Hono()

itemsRouter.get("/", async (c) => {
  const db = await getDb()
  const rows = await db.select().from(items).orderBy(items.createdAt)
  return c.json(rows)
})

itemsRouter.post("/", async (c) => {
  const body = await c.req.json<{ title?: string }>()
  const title = String(body?.title ?? "").trim()
  if (!title) return c.json({ error: "title required" }, 400)
  const db = await getDb()
  const [row] = await db.insert(items).values({ title }).returning()
  return c.json(row, 201)
})
""",
        "drizzle.config.ts": """import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
})
""",
    }


def scaffold_supports_stack(stack: str | None) -> bool:
    return (stack or "fullstack-mixed") in _VITE_STACKS
