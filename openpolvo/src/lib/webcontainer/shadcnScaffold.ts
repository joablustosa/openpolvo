import type { VirtualProjectFiles } from "./types";

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
  };
}

/** CSS global com tokens shadcn; accent e radius injectados pelo Architect. */
export function buildIndexCss(tokens?: Partial<DesignTokens>): string {
  const t = normalizeTokens(tokens);
  const primary = ACCENT_PRIMARY[t.accent] ?? ACCENT_PRIMARY.blue;
  const radius = RADIUS[t.border_radius] ?? RADIUS.md;
  const muted = PALETTE_MUTED[t.palette_base] ?? PALETTE_MUTED.zinc;
  const darkClass = t.mode === "dark" ? ' class="dark"' : "";

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
  --radius: ${radius};
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
  --ring: oklch(0.556 0 0);
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
    build: "vite build",
    preview: "vite preview",
  },
  dependencies: {
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    "@base-ui/react": "^1.4.0",
    "class-variance-authority": "^0.7.1",
    clsx: "^2.1.1",
    "lucide-react": "^1.8.0",
    "tailwind-merge": "^3.5.0",
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
  },
} as const;

const VITE_CONFIG = `import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5175,
    strictPort: false,
    hmr: { overlay: true },
  },
});
`;

const DEFAULT_APP = `import AppShell from "@/components/layout/AppShell";

export default function App() {
  return (
    <AppShell>
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
    </AppShell>
  );
}
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
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
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
    "src/App.tsx": DEFAULT_APP,
  };

  return files;
}
