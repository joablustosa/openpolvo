import type { BuilderFile, BuilderProjectType } from "@/lib/builderMetadata";
import { hasPackageJson, normalizeFsPath } from "@/lib/builderToWebContainerFiles";

/** Opções para injectar stacks (ex. Next) quando `project_type` veio do integrador. */
export type PrepareWebContainerOptions = {
  projectType?: BuilderProjectType;
};

function mapPathTailLower(map: Map<string, string>, needle: string): boolean {
  const n = needle.toLowerCase();
  for (const k of map.keys()) {
    const p = normalizeFsPath(k).toLowerCase();
    if (p === n || p.endsWith(`/${n}`)) return true;
  }
  return false;
}

function mapHasPackageJson(map: Map<string, string>): boolean {
  return mapPathTailLower(map, "package.json");
}

function fileBasenameLower(path: string): string {
  const parts = normalizeFsPath(path).split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** Qualquer `vite.config.*` no projecto (incl. `apps/web/vite.config.ts`). */
function mapHasViteConfig(map: Map<string, string>): boolean {
  for (const k of map.keys()) {
    if (/^vite\.config\.(ts|mts|js|mjs|cjs)$/i.test(fileBasenameLower(k))) return true;
  }
  return false;
}

function getKeyCaseInsensitive(map: Map<string, string>, target: string): string | null {
  const t = normalizeFsPath(target).toLowerCase();
  for (const k of map.keys()) {
    if (normalizeFsPath(k).toLowerCase() === t) return k;
  }
  return null;
}

/** `index.html` exactamente na raiz do projecto (Vite resolve por defeito da raiz). */
function mapHasProjectRootIndexHtml(map: Map<string, string>): boolean {
  return getKeyCaseInsensitive(map, "index.html") != null;
}

function findDefaultViteReactEntry(map: Map<string, string>): string | null {
  const candidates = [
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "src/app/page.tsx",
    "app/page.tsx",
    "main.tsx",
    "main.jsx",
  ];
  for (const c of candidates) {
    const key = getKeyCaseInsensitive(map, c);
    if (key && map.get(key)?.trim()) return normalizeFsPath(key);
  }
  for (const k of map.keys()) {
    const p = normalizeFsPath(k);
    const low = p.toLowerCase();
    if (low.endsWith("/main.tsx") || low === "main.tsx") return p;
    if (low.endsWith("/main.jsx") || low === "main.jsx") return p;
  }
  let best: string | null = null;
  let bestDepth = Infinity;
  for (const k of map.keys()) {
    const p = normalizeFsPath(k);
    const low = p.toLowerCase();
    if (!low.endsWith("page.tsx")) continue;
    if (!low.includes("/app/") && !low.startsWith("app/")) continue;
    const depth = p.split("/").filter(Boolean).length;
    if (depth < bestDepth) {
      bestDepth = depth;
      best = p;
    }
  }
  return best;
}

function mapHasReactLikeSource(map: Map<string, string>): boolean {
  for (const k of map.keys()) {
    if (/\.(tsx|jsx)$/i.test(k)) return true;
  }
  return false;
}

function mapLooksLikeNextJs(map: Map<string, string>): boolean {
  for (const k of map.keys()) {
    if (/^next\.config\./.test(fileBasenameLower(k))) return true;
  }
  for (const k of map.keys()) {
    const p = normalizeFsPath(k).replace(/\\/g, "/").toLowerCase();
    const inAppDir =
      p.includes("/src/app/") || p.startsWith("src/app/") || p.startsWith("app/");
    if (inAppDir && (p.endsWith("page.tsx") || p.endsWith("layout.tsx"))) return true;
    if (p.endsWith("/pages/_app.tsx") || p.endsWith("/pages/_app.jsx")) return true;
  }
  return false;
}

function shouldInjectNextSyntheticPackage(
  map: Map<string, string>,
  opts?: PrepareWebContainerOptions,
): boolean {
  if (mapHasPackageJson(map)) return false;
  if (mapHasViteConfig(map)) return false;
  if (mapLooksLikeNextJs(map)) return true;
  if (opts?.projectType === "fullstack_next") {
    for (const k of map.keys()) {
      const p = normalizeFsPath(k).replace(/\\/g, "/").toLowerCase();
      if (p.includes("app/") && (p.endsWith("page.tsx") || p.endsWith("layout.tsx"))) return true;
    }
  }
  return false;
}

/**
 * Next.js (App Router) não tem `vite.config` nem `src/main.tsx`; sem `package.json`
 * o WebContainer não arranca. Injectamos manifest + `next.config` mínimo se faltar.
 */
function ensureSyntheticNextPackageJsonIfEligible(
  map: Map<string, string>,
  opts?: PrepareWebContainerOptions,
): void {
  if (!shouldInjectNextSyntheticPackage(map, opts)) return;

  const hasPrisma = [...map.keys()].some((k) =>
    normalizeFsPath(k).toLowerCase().endsWith("prisma/schema.prisma"),
  );

  const pkg: Record<string, unknown> = {
    name: "builder-next-preview",
    private: true,
    scripts: {
      dev: "next dev -H 0.0.0.0",
      build: "next build",
      start: "next start",
    },
    dependencies: {
      next: "^15.1.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      zod: "^3.23.8",
      clsx: "^2.1.1",
      "tailwind-merge": "^2.5.4",
    },
    devDependencies: {
      "@types/node": "^22.10.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      typescript: "~5.7.0",
    },
  };
  if (hasPrisma) {
    (pkg.dependencies as Record<string, string>)["@prisma/client"] = "^5.22.0";
    (pkg.devDependencies as Record<string, string>)["prisma"] = "^5.22.0";
    (pkg.scripts as Record<string, string>).build = "prisma generate && next build";
  }

  map.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  const hasNextCfg = [...map.keys()].some((k) => /^next\.config\./i.test(fileBasenameLower(k)));
  if (!hasNextCfg) {
    map.set(
      "next.config.mjs",
      `/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
`,
    );
  }
}

/**
 * CRA / Vite clássico: só `src/App.tsx` sem `main.tsx` — cria entry para montar `<App />`.
 */
function ensureReactEntryShimForStandaloneApp(map: Map<string, string>): void {
  if (mapHasPackageJson(map)) return;
  if (mapLooksLikeNextJs(map)) return;
  if (mapHasViteConfig(map)) return;
  if (findDefaultViteReactEntry(map)) return;
  const appKey = getKeyCaseInsensitive(map, "src/App.tsx");
  if (!appKey) return;
  if (getKeyCaseInsensitive(map, "src/main.tsx") || getKeyCaseInsensitive(map, "src/main.jsx")) {
    return;
  }

  const cssLine = getKeyCaseInsensitive(map, "src/index.css")
    ? `import "./index.css";\n`
    : getKeyCaseInsensitive(map, "src/app/globals.css")
      ? `import "./app/globals.css";\n`
      : "";

  map.set(
    "src/main.tsx",
    `${cssLine}import { createRoot } from "react-dom/client";
import App from "./App";

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
`,
  );
}

/**
 * Modelo por vezes devolve só `src/*.tsx` sem `vite.config` nem `package.json`.
 * Injectamos um Vite mínimo para o WebContainer poder correr `npm run dev`.
 */
function ensureMinimalViteWhenReactWithoutTooling(map: Map<string, string>): void {
  if (mapHasPackageJson(map)) return;
  if (mapHasViteConfig(map)) return;
  if (!mapHasReactLikeSource(map)) return;
  const entry = findDefaultViteReactEntry(map);
  if (!entry) return;

  map.set(
    "vite.config.ts",
    `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true },
});
`,
  );
}

/**
 * Vite precisa de `index.html` na raiz. Copia de `public/index.html`, reutiliza outro HTML
 * com `<script type="module">`, ou gera um a partir do entry (ex. `src/main.tsx`).
 */
function ensureRootIndexHtmlForVite(map: Map<string, string>): void {
  if (!mapHasViteConfig(map)) return;
  if (mapHasProjectRootIndexHtml(map)) return;

  const pubKey = getKeyCaseInsensitive(map, "public/index.html");
  if (pubKey) {
    const html = map.get(pubKey);
    if (html?.trim()) {
      map.set("index.html", html);
      return;
    }
  }

  const viteDir = findViteProjectDirectory(map);
  if (viteDir !== null && viteDir.length > 0) {
    const subIdx = `${viteDir}/index.html`;
    const subKey = getKeyCaseInsensitive(map, subIdx);
    if (subKey && map.get(subKey)?.trim()) {
      map.set("index.html", map.get(subKey) ?? "");
      return;
    }
  }

  for (const [k, v] of [...map.entries()]) {
    const low = normalizeFsPath(k).toLowerCase();
    if (!low.endsWith(".html") || !v.trim()) continue;
    if (/<script[^>]+type=["']module["']/i.test(v)) {
      map.set("index.html", v);
      return;
    }
    if (/<script[^>]+src=["'][^"']+\.(tsx|jsx|ts|js)(\?[^"']*)?["']/i.test(v)) {
      map.set("index.html", v);
      return;
    }
  }

  const entry = findDefaultViteReactEntry(map);
  if (!entry) return;
  map.set(
    "index.html",
    `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/${entry}"></script>
</body>
</html>
`,
  );
}

function readFirstViteConfig(map: Map<string, string>): string {
  for (const k of map.keys()) {
    if (/^vite\.config\.(ts|mts|js|mjs|cjs)$/i.test(fileBasenameLower(k))) {
      return map.get(k) ?? "";
    }
  }
  return "";
}

/** Pasta que contém o `vite.config` ("" = raiz). */
function findViteProjectDirectory(map: Map<string, string>): string | null {
  for (const k of map.keys()) {
    if (!/^vite\.config\.(ts|mts|js|mjs|cjs)$/i.test(fileBasenameLower(k))) continue;
    const full = normalizeFsPath(k);
    const slash = full.lastIndexOf("/");
    return slash >= 0 ? full.slice(0, slash) : "";
  }
  return null;
}

function detectPreviewStack(
  map: Map<string, string>,
  viteSrc: string,
): "react" | "vue" | "vanilla" {
  const v = viteSrc.toLowerCase();
  if (/plugin-vue|@vitejs\/plugin-vue/.test(v)) return "vue";
  if (/plugin-react|@vitejs\/plugin-react|react\(/.test(v)) return "react";
  for (const k of map.keys()) {
    if (/\.vue$/i.test(k)) return "vue";
  }
  for (const k of map.keys()) {
    if (/\.(tsx|jsx)$/i.test(k)) return "react";
  }
  return "vanilla";
}

function usesTailwindInVite(viteSrc: string): boolean {
  return /@tailwindcss\/vite|tailwindcss\(/i.test(viteSrc);
}

/**
 * Quando o builder devolveu Vite + entrada HTML (na raiz ou corrigida acima) mas esqueceu
 * o `package.json` (ou veio num formato que não parseou), injectamos um manifest mínimo.
 */
function ensureSyntheticPackageJsonIfEligible(map: Map<string, string>): void {
  if (mapHasPackageJson(map)) return;
  if (!mapHasViteConfig(map) || !mapHasProjectRootIndexHtml(map)) return;

  const viteSrc = readFirstViteConfig(map);
  const stack = detectPreviewStack(map, viteSrc);
  const tailwind = usesTailwindInVite(viteSrc);

  const baseScripts = {
    dev: "vite --host 0.0.0.0 --strictPort",
    build: "vite build",
    preview: "vite preview --host 0.0.0.0 --strictPort --port 4173",
  };

  if (stack === "vue") {
    const pkg = {
      name: "builder-wc-preview",
      private: true,
      type: "module",
      version: "0.0.0",
      scripts: baseScripts,
      dependencies: {
        vue: "^3.5.13",
      },
      devDependencies: {
        "@vitejs/plugin-vue": "^5.2.1",
        typescript: "~5.7.0",
        vite: "^6.2.0",
        ...(tailwind
          ? { "@tailwindcss/vite": "^4.2.2", tailwindcss: "^4.2.2" }
          : {}),
      },
    };
    map.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
    return;
  }

  if (stack === "react") {
    const pkg = {
      name: "builder-wc-preview",
      private: true,
      type: "module",
      version: "0.0.0",
      scripts: baseScripts,
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.4.0",
        typescript: "~5.7.0",
        vite: "^6.2.0",
        ...(tailwind
          ? { "@tailwindcss/vite": "^4.2.2", tailwindcss: "^4.2.2" }
          : {}),
      },
    };
    map.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
    return;
  }

  const pkg = {
    name: "builder-wc-preview",
    private: true,
    type: "module",
    version: "0.0.0",
    scripts: baseScripts,
    devDependencies: {
      vite: "^6.2.0",
      typescript: "~5.7.0",
      ...(tailwind
        ? { "@tailwindcss/vite": "^4.2.2", tailwindcss: "^4.2.2" }
        : {}),
    },
  };
  map.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

function cloneFiles(files: BuilderFile[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    const p = normalizeFsPath(f.path);
    if (p) m.set(p, f.content);
  }
  return m;
}

function toBuilderFiles(map: Map<string, string>): BuilderFile[] {
  return [...map.entries()].map(([path, content]) => ({
    path,
    language: inferLang(path),
    content,
  }));
}

function inferLang(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

/** Garante .npmrc para instalações mais tolerantes (peer deps, menos ruído). */
function ensureNpmrc(map: Map<string, string>): void {
  const key = ".npmrc";
  const base = ["legacy-peer-deps=true", "fund=false", "audit=false"].join("\n");
  const cur = map.get(key);
  if (!cur?.trim()) {
    map.set(key, `${base}\n`);
    return;
  }
  let next = cur;
  if (!/legacy-peer-deps/i.test(next)) next = `${next.trim()}\nlegacy-peer-deps=true\n`;
  if (!/^fund=false/m.test(next)) next = `${next.trim()}\nfund=false\n`;
  map.set(key, next);
}

/**
 * Vite dentro do WebContainer precisa de `server.host` para o URL de preview
 * ser acessível ao iframe (padrão StackBlitz / Lovable).
 */
function patchViteConfigForWebContainerHost(content: string): string {
  if (/\bhost\s*:\s*true\b/.test(content) || /host\s*:\s*['"]0\.0\.0\.0['"]/.test(content)) {
    return content;
  }
  // Já existe bloco server sem host — inject host
  if (/\bserver\s*:\s*\{/.test(content)) {
    if (!/\bhost\s*:/.test(content)) {
      return content.replace(/(\bserver\s*:\s*\{)/, "$1\n    host: true,");
    }
    return content;
  }
  const m = content.match(/defineConfig\s*\(\s*(?:async\s*)?\{/);
  if (m && m.index !== undefined) {
    const insertAt = m.index + m[0].length;
    return `${content.slice(0, insertAt)}\n  server: { host: true },${content.slice(insertAt)}`;
  }
  return content;
}

function patchViteConfigHmrOverlayOff(content: string): string {
  if (/hmr\s*:\s*\{[^}]*overlay\s*:\s*false/.test(content)) return content;
  if (!/\bserver\s*:\s*\{/.test(content)) return content;
  return content.replace(/(\bserver\s*:\s*\{)/, "$1\n    hmr: { overlay: false },");
}

function patchAnyViteConfig(map: Map<string, string>): void {
  for (const [name, cur] of map.entries()) {
    if (!/^vite\.config\.(ts|mts|js|mjs|cjs)$/i.test(fileBasenameLower(name))) continue;
    let next = patchViteConfigForWebContainerHost(cur);
    next = patchViteConfigHmrOverlayOff(next);
    if (next !== cur) map.set(name, next);
  }
}

function viteUsesTailwindVitePlugin(map: Map<string, string>): boolean {
  for (const [k, c] of map.entries()) {
    if (!/^vite\.config\./i.test(fileBasenameLower(k))) continue;
    if (/@tailwindcss\/vite/.test(c)) return true;
  }
  return false;
}

function anyCssImportsTailwindV4(map: Map<string, string>): boolean {
  for (const [k, c] of map.entries()) {
    if (!/\.(css|scss)$/i.test(k)) continue;
    if (/@import\s+["']tailwindcss["']/.test(c)) return true;
  }
  return false;
}

function isPostcssConfigPath(path: string): boolean {
  return /^postcss\.config\.(mjs|cjs|js|ts|mts)$/i.test(fileBasenameLower(path));
}

function postcssReferencesTailwindStack(content: string): boolean {
  return (
    /\btailwindcss\b/.test(content) ||
    /["']tailwindcss["']/.test(content) ||
    /require\s*\(\s*["']tailwindcss["']\s*\)/.test(content) ||
    /@tailwindcss\/postcss/.test(content)
  );
}

function mergePackageJsonDeps(
  map: Map<string, string>,
  extra: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): void {
  const k = getKeyCaseInsensitive(map, "package.json");
  if (!k) return;
  const raw = map.get(k);
  if (!raw) return;
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const prevDep =
      typeof pkg.dependencies === "object" && pkg.dependencies
        ? (pkg.dependencies as Record<string, string>)
        : {};
    const prevDev =
      typeof pkg.devDependencies === "object" && pkg.devDependencies
        ? (pkg.devDependencies as Record<string, string>)
        : {};
    pkg.dependencies = { ...prevDep, ...(extra.dependencies || {}) };
    pkg.devDependencies = { ...prevDev, ...(extra.devDependencies || {}) };
    map.set(k, JSON.stringify(pkg, null, 2) + "\n");
  } catch {
    // ignore JSON inválido
  }
}

function emptyPostcssExportLike(original: string): string {
  if (/module\.exports/.test(original)) {
    return `module.exports = { plugins: {} };\n`;
  }
  return `/** WebContainer: PostCSS sem plugins duplicados (Tailwind via Vite ou só bundler). */\nexport default {\n  plugins: {},\n};\n`;
}

function postcssTailwindV4OfficialBlock(): string {
  return `/**\n * Tailwind 4 + PostCSS: plugin oficial (evita ENOENT ao resolver "tailwindcss" como ficheiro).\n */\nexport default {\n  plugins: {\n    "@tailwindcss/postcss": {},\n  },\n};\n`;
}

/**
 * Corrige combinações PostCSS + Tailwind que no WebContainer geram
 * `ENOENT ... open 'tailwindcss'` (plugin / deps em falta ou duplicado com @tailwindcss/vite).
 */
function patchPostcssTailwindInterop(map: Map<string, string>): void {
  const viteTw = viteUsesTailwindVitePlugin(map);
  const tw4Import = anyCssImportsTailwindV4(map);

  for (const [path, content] of [...map.entries()]) {
    if (!isPostcssConfigPath(path)) continue;
    if (!postcssReferencesTailwindStack(content)) continue;

    if (viteTw) {
      map.set(path, emptyPostcssExportLike(content));
      continue;
    }

    if (tw4Import || /@tailwindcss\/postcss/.test(content)) {
      map.set(path, postcssTailwindV4OfficialBlock());
      mergePackageJsonDeps(map, {
        devDependencies: {
          "@tailwindcss/postcss": "^4.2.2",
          postcss: "^8.4.49",
          tailwindcss: "^4.2.2",
        },
      });
      continue;
    }

    mergePackageJsonDeps(map, {
      devDependencies: {
        postcss: "^8.4.49",
        tailwindcss: "^3.4.17",
        autoprefixer: "^10.4.20",
      },
    });
  }
}

/** Registo do Vite indica falha PostCSS/Tailwind conhecida. */
export function shouldRepairFromViteLog(log: string): boolean {
  return /ENOENT.*tailwindcss|open\s+['"]tailwindcss['"]|\[plugin:vite:css\][\s\S]{0,200}postcss/i.test(
    log,
  );
}

/**
 * Reaplica só correcções determinísticas (postcss + package.json) com base no **contexto**
 * do registo do Vite — não reescreve ficheiros que não precisam de alteração.
 */
export function repairBuilderFilesFromViteLog(files: BuilderFile[], log: string): BuilderFile[] {
  if (!shouldRepairFromViteLog(log)) return files;
  const map = cloneFiles(files);
  patchPostcssTailwindInterop(map);
  return toBuilderFiles(map);
}

/** Conteúdo do `index.html` na raiz (chave case-insensitive). */
function getRootIndexHtmlContent(map: Map<string, string>): string | undefined {
  const k = getKeyCaseInsensitive(map, "index.html");
  return k ? map.get(k) : undefined;
}

/** Descobre o entry ES module a partir do index.html na raiz. */
function findRootHtmlEntry(map: Map<string, string>): string | null {
  const html = getRootIndexHtmlContent(map);
  if (!html) return null;
  const tags = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)];
  for (const m of tags) {
    const raw = m[1]?.split("?")[0]?.trim();
    if (!raw) continue;
    const low = raw.toLowerCase();
    const isModule =
      /type\s*=\s*["']module["']/i.test(m[0] ?? "") ||
      low.endsWith(".tsx") ||
      low.endsWith(".jsx") ||
      low.endsWith(".ts") ||
      low.includes("/src/");
    if (!isModule) continue;
    let src = raw;
    if (src.startsWith("/")) src = src.slice(1);
    const norm = normalizeFsPath(src);
    if (norm) return norm;
  }
  return null;
}

function cssImportLine(fromEntry: string, cssPath: string): string {
  const fromDir = fromEntry.includes("/") ? fromEntry.slice(0, fromEntry.lastIndexOf("/")) : "";
  const partsFrom = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const partsTo = cssPath.split("/").filter(Boolean);
  let i = 0;
  while (i < partsFrom.length && i < partsTo.length && partsFrom[i] === partsTo[i]) i++;
  const up = partsFrom.length - i;
  const down = partsTo.slice(i);
  const rel = `${"../".repeat(up)}${down.join("/")}`;
  const q = rel.startsWith(".") ? rel : `./${rel}`;
  return `import "${q}";\n`;
}

function hasCssImport(source: string): boolean {
  return /import\s+[^'"]*['"][^'"]+\.(css|scss|sass|less)['"]/.test(source);
}

/**
 * Garante que o entry (ex. src/main.tsx) importa o CSS global (Tailwind / shadcn),
 * para o Vite processar estilos — evita página React “sem formatação”.
 */
function ensureCssImportedFromHtmlEntry(map: Map<string, string>): void {
  const entry = findRootHtmlEntry(map);
  if (!entry) return;
  const source = map.get(entry);
  if (!source) return;
  if (hasCssImport(source)) return;

  const candidates = [
    "src/index.css",
    "src/app/globals.css",
    "src/styles.css",
    "src/globals.css",
    "src/global.css",
    "src/app.css",
    "src/App.css",
  ];
  for (const cssPath of candidates) {
    if (!map.has(cssPath)) continue;
    const line = cssImportLine(entry, cssPath);
    map.set(entry, `${line}${source}`);
    return;
  }
}

/**
 * Reduz falhas sob COEP `require-corp`: imports de Google Fonts em CSS quebram sem crossorigin.
 * Substitui por stack de sistema (Tailwind/shadcn continuam a funcionar).
 */
function relaxGoogleFontImportsInCss(map: Map<string, string>): void {
  const fontImport =
    /@import\s+url\s*\(\s*['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/gi;
  for (const [path, content] of map.entries()) {
    if (!path.toLowerCase().endsWith(".css")) continue;
    if (!fontImport.test(content)) continue;
    fontImport.lastIndex = 0;
    const next = content.replace(
      fontImport,
      "/* @import Google Fonts omitido no preview WebContainer (COEP); usa fontes do sistema */\n",
    );
    map.set(path, next);
  }
}

/**
 * Explica por que o modo npm/WebContainer não ficou disponível (para UI e suporte).
 */
export function explainWebContainerPrepareFailure(
  rawFiles: BuilderFile[],
  preparedFiles: BuilderFile[],
  projectType: BuilderProjectType,
): string {
  if (!rawFiles.length) {
    return (
      "O artefacto do builder chegou sem ficheiros (`files` vazio). Causas frequentes: o integrador só devolveu `preview_html`; o JSON do LLM veio incompleto; ou a coluna `metadata` na base de dados truncou o payload. Confirme na mensagem assistente (campo metadata) e nos logs do Open Polvo Intelligence."
    );
  }
  if (!hasPackageJson(preparedFiles)) {
    const sample = rawFiles
      .slice(0, 28)
      .map((f) => normalizeFsPath(f.path))
      .join(", ");
    const nextHint =
      projectType === "fullstack_next"
        ? "Para Next.js, o inject automático precisa de `next.config.*` ou de `**/app/**/page.tsx` sem Vite na raiz (ou `project_type: fullstack_next` com `page.tsx`). "
        : "";
    return `${nextHint}Sem \`package.json\` após preparação. Caminhos recebidos (amostra): ${sample || "(n/a)"}.`;
  }
  return "";
}

/**
 * Prepara ficheiros gerados pelo builder para correr de forma fiável no WebContainer
 * (Vite + Tailwind/shadcn, estilo Lovable-like).
 */
export function prepareBuilderFilesForWebContainer(
  files: BuilderFile[],
  opts?: PrepareWebContainerOptions,
): BuilderFile[] {
  const map = cloneFiles(files);
  ensureSyntheticNextPackageJsonIfEligible(map, opts);
  ensureReactEntryShimForStandaloneApp(map);
  ensureMinimalViteWhenReactWithoutTooling(map);
  ensureRootIndexHtmlForVite(map);
  ensureSyntheticPackageJsonIfEligible(map);
  patchAnyViteConfig(map);
  patchPostcssTailwindInterop(map);
  ensureNpmrc(map);
  ensureCssImportedFromHtmlEntry(map);
  relaxGoogleFontImportsInCss(map);
  return toBuilderFiles(map);
}
