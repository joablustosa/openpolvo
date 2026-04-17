/**
 * Tipos e parser para o payload `builder` retornado pelo sub-grafo Builder
 * (intenção `criacao_app_interativa`). Fica em `message.metadata.builder`.
 */

export type BuilderProjectType =
  | "frontend_only"
  | "fullstack_node"
  | "fullstack_go_hexagonal";

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
  "fullstack_node",
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

/** Extrai `builder` da metadata de uma mensagem do assistente. */
export function parseBuilderMeta(metadata: unknown): BuilderData | null {
  const meta = parseMetaObj(metadata);
  if (!meta) return null;
  const raw = parseMetaObj(meta.builder);
  if (!raw) return null;

  const files = Array.isArray(raw.files)
    ? ((raw.files as unknown[])
        .map(parseFile)
        .filter(Boolean) as BuilderFile[])
    : [];

  // Precisa de, pelo menos, ficheiros ou preview_html para ser útil.
  const preview_html = typeof raw.preview_html === "string" ? raw.preview_html : "";
  if (files.length === 0 && !preview_html) return null;

  const data: BuilderData = {
    title: typeof raw.title === "string" ? raw.title : "Aplicação",
    description: typeof raw.description === "string" ? raw.description : "",
    project_type: parseProjectType(raw.project_type),
    framework: typeof raw.framework === "string" ? raw.framework : "",
    entry_file: typeof raw.entry_file === "string" ? raw.entry_file : "",
    files,
    preview_html,
  };
  if (typeof raw.deploy_instructions === "string" && raw.deploy_instructions.trim()) {
    data.deploy_instructions = raw.deploy_instructions;
  }
  const rs = parseReviewSummary(raw.review_summary);
  if (rs) data.review_summary = rs;
  return data;
}

/** Rótulo amigável do project_type para UI. */
export function projectTypeLabel(t: BuilderProjectType): string {
  switch (t) {
    case "fullstack_node":
      return "Fullstack · Node";
    case "fullstack_go_hexagonal":
      return "Fullstack · Go";
    case "frontend_only":
    default:
      return "Frontend";
  }
}
