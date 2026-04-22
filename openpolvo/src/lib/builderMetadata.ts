/**
 * Tipos e parser para o payload `builder` retornado pelo sub-grafo Builder
 * (intenção `criacao_app_interativa`). Fica em `message.metadata.builder`.
 */

export type BuilderProjectType =
  | "frontend_only"
  | "landing_page"
  | "fullstack_node"
  | "fullstack_next"
  | "fullstack_go_hexagonal";

export type BuilderRecommendation = {
  project_type: BuilderProjectType;
  tradeoff: string;
};

export type BuilderFile = {
  path: string;
  language: string;
  content: string;
};

export type BuilderReviewSummary = {
  tests_ok: boolean;
  issues_fixed: number;
  remaining_warnings: string[];
};

export type BuilderData = {
  title: string;
  description: string;
  project_type: BuilderProjectType;
  framework: string;
  entry_file: string;
  files: BuilderFile[];
  preview_html: string;
  deploy_instructions?: string;
  review_summary?: BuilderReviewSummary;
  recommendation_reason?: string;
  recommendations?: BuilderRecommendation[];
};

function parseMetaObj(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

const VALID_PROJECT_TYPES: BuilderProjectType[] = [
  "frontend_only",
  "landing_page",
  "fullstack_node",
  "fullstack_next",
  "fullstack_go_hexagonal",
];

function parseProjectType(v: unknown): BuilderProjectType {
  if (typeof v === "string" && (VALID_PROJECT_TYPES as string[]).includes(v)) {
    return v as BuilderProjectType;
  }
  return "frontend_only";
}

function parseFile(raw: unknown): BuilderFile | null {
  const f = parseMetaObj(raw);
  if (!f) return null;
  const path = typeof f.path === "string" ? f.path.trim() : "";
  const content = typeof f.content === "string" ? f.content : "";
  if (!path) return null;
  const language =
    typeof f.language === "string" && f.language.trim()
      ? f.language.trim()
      : inferLanguage(path);
  return { path, language, content };
}

/**
 * O modelo ou a API por vezes enviam `files` como mapa `{ "src/App.tsx": "..." }`
 * em vez de um array de `{ path, content }`. Sem isto o `package.json` “desaparece”
 * e o WebContainer fica desactivado.
 */
function coerceBuilderFilesArray(rawFiles: unknown): BuilderFile[] {
  if (rawFiles == null) return [];
  if (Array.isArray(rawFiles)) {
    return (rawFiles as unknown[])
      .map(parseFile)
      .filter(Boolean) as BuilderFile[];
  }
  if (typeof rawFiles === "object" && !Array.isArray(rawFiles)) {
    const obj = rawFiles as Record<string, unknown>;
    const out: BuilderFile[] = [];
    for (const [key, val] of Object.entries(obj)) {
      const fallbackPath = typeof key === "string" ? key.trim() : "";
      if (!fallbackPath) continue;
      if (typeof val === "string") {
        const bf = parseFile({
          path: fallbackPath,
          content: val,
          language: inferLanguage(fallbackPath),
        });
        if (bf) out.push(bf);
      } else if (val && typeof val === "object") {
        const o = val as Record<string, unknown>;
        const path =
          typeof o.path === "string" && o.path.trim()
            ? o.path.trim()
            : fallbackPath;
        const merged = parseFile({ ...o, path });
        if (merged) out.push(merged);
      }
    }
    return out;
  }
  return [];
}

function inferLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  return "text";
}

function parseReviewSummary(raw: unknown): BuilderReviewSummary | undefined {
  const r = parseMetaObj(raw);
  if (!r) return undefined;
  const warnings = Array.isArray(r.remaining_warnings)
    ? (r.remaining_warnings as unknown[]).map(String)
    : [];
  return {
    tests_ok: Boolean(r.tests_ok),
    issues_fixed: Number(r.issues_fixed) || 0,
    remaining_warnings: warnings,
  };
}

/** Remove cercas Markdown acidentais à volta do HTML. */
function unwrapMarkdownFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:html|htm)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i);
  return m ? m[1].trim() : t;
}

/**
 * Normaliza vários formatos que o LLM pode devolver em vez de `preview_html` string.
 */
function coercePreviewHtmlField(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") {
    return unwrapMarkdownFence(String(v));
  }
  if (typeof v === "string") {
    return unwrapMarkdownFence(v);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["html", "body", "content", "src", "preview_html", "previewHtml"]) {
      const inner = o[k];
      if (typeof inner === "string" && inner.trim()) {
        return unwrapMarkdownFence(inner.trim());
      }
    }
  }
  return "";
}

/** Lê preview explícito do objecto `builder` (várias chaves / aninhamentos). */
function extractExplicitPreviewHtml(raw: Record<string, unknown>): string {
  const keys = [
    "preview_html",
    "previewHtml",
    "html_preview",
    "htmlPreview",
    "preview",
    "html",
    "previewDocument",
  ];
  for (const k of keys) {
    const got = coercePreviewHtmlField(raw[k]);
    if (got) return got;
  }
  return "";
}

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

/**
 * Se o integrador não devolver `preview_html`, tenta usar um ficheiro HTML do projecto
 * (entrada ou index) para o iframe — caso típico em que o modelo só preenche `files`.
 */
function derivePreviewHtmlFromFiles(files: BuilderFile[], entryFile: string): string {
  if (!files.length) return "";
  const pathKey = (p: string) => normalizeFsPath(p).toLowerCase();
  const byPath = new Map(files.map((f) => [pathKey(f.path), f] as const));

  const entryNorm = normalizeFsPath(entryFile);
  if (entryNorm && /\.html?$/i.test(entryNorm)) {
    const hit =
      byPath.get(pathKey(entryFile)) ??
      files.find((f) => pathKey(f.path) === pathKey(entryFile));
    const c = hit?.content?.trim();
    if (c) return c;
  }

  const indexNames = [
    "index.html",
    "public/index.html",
    "src/index.html",
    "dist/index.html",
    "static/index.html",
  ];
  for (const name of indexNames) {
    const key = pathKey(name);
    const hit =
      byPath.get(key) ??
      files.find((f) => pathKey(f.path) === key || pathKey(f.path).endsWith(`/${key}`));
    const c = hit?.content?.trim();
    if (c) return c;
  }

  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path));
  htmlFiles.sort(
    (a, b) =>
      normalizeFsPath(a.path).split("/").length - normalizeFsPath(b.path).split("/").length ||
      a.path.localeCompare(b.path),
  );
  const c = htmlFiles[0]?.content?.trim();
  return c ?? "";
}

/**
 * Artefacto Builder para abrir o painel lateral **só** quando o encaminhamento
 * foi `criacao_app_interativa` (desenvolvimento); outras intenções ficam no chat.
 */
export function builderDataFromAssistantMetadata(metadata: unknown): BuilderData | null {
  const meta = parseMetaObj(metadata);
  if (!meta) return null;
  if (String(meta.routed_intent ?? "").trim() !== "criacao_app_interativa") return null;
  return parseBuilderMeta(metadata);
}

/** Extrai `builder` da metadata de uma mensagem do assistente. */
export function parseBuilderMeta(metadata: unknown): BuilderData | null {
  const meta = parseMetaObj(metadata);
  if (!meta) return null;
  const raw = parseMetaObj(meta.builder);
  if (!raw) return null;

  const files = coerceBuilderFilesArray(raw.files);

  const entry_file = typeof raw.entry_file === "string" ? raw.entry_file : "";
  let preview_html = extractExplicitPreviewHtml(raw);
  if (!preview_html.trim() && files.length > 0) {
    preview_html = derivePreviewHtmlFromFiles(files, entry_file);
  }

  // Precisa de, pelo menos, ficheiros ou preview_html para ser útil.
  if (files.length === 0 && !preview_html.trim()) return null;

  const data: BuilderData = {
    title: typeof raw.title === "string" ? raw.title : "Aplicação",
    description: typeof raw.description === "string" ? raw.description : "",
    project_type: parseProjectType(raw.project_type),
    framework: typeof raw.framework === "string" ? raw.framework : "",
    entry_file,
    files,
    preview_html,
  };
  if (typeof raw.deploy_instructions === "string" && raw.deploy_instructions.trim()) {
    data.deploy_instructions = raw.deploy_instructions;
  }
  const rs = parseReviewSummary(raw.review_summary);
  if (rs) data.review_summary = rs;
  if (typeof raw.recommendation_reason === "string" && raw.recommendation_reason.trim()) {
    data.recommendation_reason = raw.recommendation_reason.trim();
  }
  if (Array.isArray(raw.recommendations)) {
    const recs: BuilderRecommendation[] = [];
    for (const r of raw.recommendations) {
      const m = parseMetaObj(r);
      if (!m) continue;
      const pt = parseProjectType(m.project_type);
      const tradeoff = typeof m.tradeoff === "string" ? m.tradeoff.trim() : "";
      if (tradeoff) recs.push({ project_type: pt, tradeoff });
    }
    if (recs.length) data.recommendations = recs;
  }
  return data;
}

/** Mensagem mínima para procurar metadata `builder` (ex.: histórico de conversa). */
export type MessageLikeForBuilder = {
  role: string;
  metadata?: unknown;
};

/**
 * Devolve o artefacto Builder mais recente numa lista de mensagens (última resposta
 * do assistente com `metadata.builder` válido).
 */
export function findLatestBuilderDataInMessages(
  messages: readonly MessageLikeForBuilder[],
): BuilderData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const bd = parseBuilderMeta(m.metadata);
    if (bd) return bd;
  }
  return null;
}

/** Rótulo amigável do project_type para UI. */
export function projectTypeLabel(t: BuilderProjectType): string {
  switch (t) {
    case "landing_page":
      return "Landing Page";
    case "fullstack_node":
      return "Fullstack · Node";
    case "fullstack_next":
      return "Fullstack · Next.js";
    case "fullstack_go_hexagonal":
      return "Fullstack · Go";
    case "frontend_only":
    default:
      return "Frontend";
  }
}
