/**
 * Metadata `polvo_code_ops` do Intelligence → aplicação no disco via IPC Electron.
 */

import {
  dispatchDevStudioApplyEnd,
  dispatchDevStudioApplyStart,
} from "@/lib/devStudioApplyEvents";
import { getDevStudioConversationProject } from "@/lib/devStudio/conversationProjectLink";
import { DEV_STUDIO_NATIVE_APP_ID } from "@/config/apps";
import type { AppId } from "@/config/apps";
import type { DesignTokens } from "@/lib/webcontainer/shadcnScaffold";

export type DevStudioOpKind = "write" | "mkdir";

export type DevStudioOp = {
  op: DevStudioOpKind;
  path: string;
  content?: string;
};

export type ParsedDevStudioMessageMeta = {
  polvo_code_ops_pending?: boolean;
  polvo_code_ops_blocked?: boolean;
  polvo_code_ops_errors?: string[];
  polvo_code_ops?: DevStudioOp[];
  polvo_code_create_project?: boolean;
  polvo_code_project_title?: string;
  polvo_code_npm_install?: boolean;
  routed_intent?: string;
};

export type DevWorkflowEditMode =
  | "create"
  | "modify"
  | "mixed"
  | "diff_patch"
  | string;

export type EnrichedBrief = {
  objective: string;
  audience: string;
  sections: string[];
  tone: string;
  palette_hint?: string;
  layout_shell?: "marketing" | "dashboard" | string;
};

function parseMetadataRaw(metadata: unknown): Record<string, unknown> | null {
  if (metadata == null) return null;
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata === "string") {
    try {
      const o = JSON.parse(metadata) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function extractEnrichedBriefFromMetadata(metadata: unknown): EnrichedBrief | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const dw = m.dev_workflow;
  if (!dw || typeof dw !== "object" || Array.isArray(dw)) return null;
  const brief = (dw as Record<string, unknown>).enriched_brief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return null;
  const b = brief as Record<string, unknown>;
  const objective = typeof b.objective === "string" ? b.objective.trim() : "";
  const audience = typeof b.audience === "string" ? b.audience.trim() : "";
  const tone = typeof b.tone === "string" ? b.tone.trim() : "";
  const palette_hint = typeof b.palette_hint === "string" ? b.palette_hint.trim() : undefined;
  const layout_shell =
    typeof b.layout_shell === "string" ? b.layout_shell.trim() : undefined;
  const sectionsRaw = b.sections;
  const sections = Array.isArray(sectionsRaw)
    ? sectionsRaw.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const hasAny = Boolean(objective || audience || tone || sections.length);
  if (!hasAny) return null;
  return { objective, audience, tone, sections, palette_hint, layout_shell };
}

export function extractDevWorkflowEditModeFromMetadata(metadata: unknown): DevWorkflowEditMode | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const dw = m.dev_workflow;
  if (!dw || typeof dw !== "object" || Array.isArray(dw)) return null;
  const em = (dw as Record<string, unknown>).edit_mode;
  if (typeof em !== "string" || !em.trim()) return null;
  return em.trim();
}

export function parseDevStudioMessageMeta(
  metadata: unknown,
): ParsedDevStudioMessageMeta | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const opsRaw = m.polvo_code_ops;
  const ops: DevStudioOp[] = [];
  if (Array.isArray(opsRaw)) {
    for (const row of opsRaw) {
      if (!row || typeof row !== "object") continue;
      const op = String((row as Record<string, unknown>).op ?? "").trim();
      const path = String((row as Record<string, unknown>).path ?? "").trim();
      if (op !== "write" && op !== "mkdir") continue;
      if (!path) continue;
      const content = (row as Record<string, unknown>).content;
      ops.push({
        op: op as DevStudioOpKind,
        path,
        content: op === "write" ? String(content ?? "") : undefined,
      });
    }
  }
  const errRaw = m.polvo_code_ops_errors;
  const errs = Array.isArray(errRaw)
    ? errRaw.map((e) => String(e)).filter(Boolean)
    : [];
  return {
    polvo_code_ops_pending: Boolean(m.polvo_code_ops_pending),
    polvo_code_ops_blocked: Boolean(m.polvo_code_ops_blocked),
    polvo_code_ops_errors: errs.length ? errs : undefined,
    polvo_code_ops: ops.length ? ops : undefined,
    polvo_code_create_project: Boolean(m.polvo_code_create_project),
    polvo_code_project_title:
      typeof m.polvo_code_project_title === "string"
        ? m.polvo_code_project_title.trim()
        : undefined,
    polvo_code_npm_install: Boolean(m.polvo_code_npm_install),
    routed_intent:
      typeof m.routed_intent === "string" ? m.routed_intent.trim() : undefined,
  };
}

export function shouldApplyDevStudioOps(metadata: unknown): boolean {
  const p = parseDevStudioMessageMeta(metadata);
  const ops = p?.polvo_code_ops ?? [];
  if (!ops.length) return false;
  // Bloqueia só quando não há ops; avisos parciais no metadata não impedem apply.
  if (p?.polvo_code_ops_blocked && ops.length === 0) return false;
  if (p?.polvo_code_ops_pending && ops.length > 0) return true;
  return ops.length > 0;
}

function extractProjectFilesFromMetadata(
  metadata: unknown,
): Record<string, string> | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const dsc = m.dev_studio_context;
  if (!dsc || typeof dsc !== "object" || Array.isArray(dsc)) return null;
  const pf = (dsc as Record<string, unknown>).project_files;
  if (!pf || typeof pf !== "object" || Array.isArray(pf)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pf as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim() && typeof v === "string") {
      out[k.replace(/\\/g, "/")] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Indica se há ficheiros ou ops para aplicar no preview (Electron / WebContainer). */
export function shouldApplyDevStudioFromMetadata(metadata: unknown): boolean {
  if (shouldApplyDevStudioOps(metadata)) return true;
  const files = extractProjectFilesFromMetadata(metadata);
  if (files && Object.keys(files).length >= 1) {
    const p = parseDevStudioMessageMeta(metadata);
    if (p?.polvo_code_ops_blocked) return false;
    if (
      p?.routed_intent === "polvo_code_builder" ||
      messageIndicatesDevStudioInteraction(metadata)
    ) {
      return true;
    }
  }
  return false;
}

function projectFilesToOps(files: Record<string, string>): DevStudioOp[] {
  return Object.entries(files).map(([path, content]) => ({
    op: "write" as const,
    path,
    content,
  }));
}

function synthesizeOpsMetadata(
  ops: DevStudioOp[],
  base: ParsedDevStudioMessageMeta | null,
): Record<string, unknown> {
  const title = base?.polvo_code_project_title?.trim() || "landing-page";
  const createProject = Boolean(base?.polvo_code_create_project) || !base;
  const npmInstall =
    Boolean(base?.polvo_code_npm_install) ||
    createProject ||
    touchesPackageJson(ops);
  return {
    polvo_code_ops_pending: true,
    polvo_code_ops_blocked: false,
    polvo_code_ops: ops,
    polvo_code_create_project: createProject,
    polvo_code_project_title: title,
    polvo_code_npm_install: npmInstall,
    routed_intent: base?.routed_intent ?? "polvo_code_builder",
    native_plugin: {
      id: "dev_studio",
      url: "",
      label: "Estúdio (preview)",
    },
  };
}

/** Lê `dev_studio_context.project_id` da metadata (workspacePath no Electron). */
export function extractDevStudioProjectFromMetadata(
  metadata: unknown,
): { workspacePath: string; title: string | null } | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const dsc = m.dev_studio_context;
  if (!dsc || typeof dsc !== "object" || Array.isArray(dsc)) return null;
  const dscObj = dsc as Record<string, unknown>;
  const wp = dscObj.project_id;
  if (typeof wp !== "string" || !wp.trim()) return null;
  const titleRaw =
    typeof m.polvo_code_project_title === "string"
      ? m.polvo_code_project_title.trim()
      : "";
  return { workspacePath: wp.trim(), title: titleRaw || null };
}

/** Procura nas mensagens (da mais recente para a mais antiga) o último projecto Dev Studio. */
export function restoreDevStudioProjectFromMessages(
  messages: Array<{ role: string; metadata?: unknown }>,
): { workspacePath: string; title: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const proj = extractDevStudioProjectFromMetadata(m.metadata);
    if (proj) return proj;
  }
  return null;
}

/** Mensagens + ligação local (conversa ↔ pasta no disco). */
export function resolveDevStudioProjectForConversation(
  conversationId: string,
  messages: Array<{ role: string; metadata?: unknown }>,
): { workspacePath: string; title: string | null } | null {
  const fromMessages = restoreDevStudioProjectFromMessages(messages);
  if (fromMessages) return fromMessages;
  if (!conversationId.trim()) return null;
  const linked = getDevStudioConversationProject(conversationId);
  if (!linked) return null;
  return { workspacePath: linked.workspacePath, title: linked.title };
}

/** Actualiza a última mensagem assistant com `dev_studio_context.project_id` (sessão actual). */
export function patchAssistantDevStudioProjectId<T extends { role: string; metadata?: unknown }>(
  messages: T[],
  workspacePath: string,
  title?: string | null,
): T[] {
  const wp = workspacePath.trim();
  if (!wp) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const m = parseMetadataRaw(messages[i].metadata);
    if (!m) return messages;
    const dscRaw = m.dev_studio_context;
    const dsc =
      dscRaw && typeof dscRaw === "object" && !Array.isArray(dscRaw)
        ? { ...(dscRaw as Record<string, unknown>) }
        : {};
    dsc.project_id = wp;
    const nextMeta = {
      ...m,
      dev_studio_context: dsc,
      ...(title?.trim() ? { polvo_code_project_title: title.trim() } : {}),
    };
    return messages.map((msg, idx) =>
      idx === i ? ({ ...msg, metadata: nextMeta } as T) : msg,
    );
  }
  return messages;
}

/** Normaliza metadata para aplicar ops (inclui fallback a project_files). */
export function normalizeDevStudioApplyMetadata(metadata: unknown): unknown {
  if (shouldApplyDevStudioOps(metadata)) return metadata;
  const files = extractProjectFilesFromMetadata(metadata);
  if (!files) return metadata;
  const base = parseDevStudioMessageMeta(metadata);
  if (base?.polvo_code_ops_blocked) return metadata;
  const ops = projectFilesToOps(files);
  if (!ops.length) return metadata;
  const m = parseMetadataRaw(metadata) ?? {};
  return { ...m, ...synthesizeOpsMetadata(ops, base) };
}

export function messageIndicatesDevStudioInteraction(metadata: unknown): boolean {
  const m = parseMetadataRaw(metadata);
  if (!m) return false;
  const routed = String(m.routed_intent ?? m.intent ?? "").trim();
  if (routed === "polvo_code_builder") return true;
  const p = parseDevStudioMessageMeta(metadata);
  if (p?.polvo_code_ops_pending) return true;
  if (p?.polvo_code_ops && p.polvo_code_ops.length > 0) return true;
  if (m.native_plugin && typeof m.native_plugin === "object") return true;
  return false;
}

export function devStudioApplyFailureMessage(metadata: unknown): string | null {
  const p = parseDevStudioMessageMeta(metadata);
  if (!p) return null;
  const m = parseMetadataRaw(metadata);
  const routed = String(m?.routed_intent ?? "").trim();
  if (
    routed === "polvo_code_builder" &&
    (!p.polvo_code_ops || p.polvo_code_ops.length === 0)
  ) {
    return (
      "O agente respondeu no chat mas não gerou alterações no código. " +
      "Tente reformular (ex.: «aplica no preview: muda o botão para verde») ou recarregue o preview."
    );
  }
  if (p.polvo_code_ops_blocked && p.polvo_code_ops_errors?.length) {
    return `Não foi possível aplicar no projecto: ${p.polvo_code_ops_errors.join("; ")}`;
  }
  if (
    p.routed_intent === "polvo_code_builder" &&
    !p.polvo_code_ops_pending &&
    (!p.polvo_code_ops || p.polvo_code_ops.length === 0)
  ) {
    return "O agente não produziu ficheiros para o preview. Tenta pedir de novo com mais detalhe (ex.: «landing page para cafeteria, cores quentes»).";
  }
  return null;
}

function getDevWorkflow(metadata: unknown): Record<string, unknown> | null {
  const m = parseMetadataRaw(metadata);
  if (!m) return null;
  const dw = m.dev_workflow;
  if (!dw || typeof dw !== "object" || Array.isArray(dw)) return null;
  return dw as Record<string, unknown>;
}

const DESIGN_TOKEN_KEYS = [
  "palette_base",
  "border_radius",
  "accent",
  "mode",
  "layout_shell",
] as const;

function extractDesignTokensFromMetadata(
  metadata: unknown,
): Partial<DesignTokens> | undefined {
  const dw = getDevWorkflow(metadata);
  if (!dw) return undefined;
  const raw = dw.design_tokens;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rawObj = raw as Record<string, unknown>;
  const out: Partial<DesignTokens> = {};
  for (const key of DESIGN_TOKEN_KEYS) {
    const v = rawObj[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

export type StyleGuide = {
  domain: string;
  palette: string;
  tone: string;
  layout_shell: string;
  references: string[];
  tokens: Record<string, string>;
};

/** Lê `dev_workflow.style_guide` (guia de estilo por solicitação) da metadata. */
export function extractStyleGuideFromMetadata(
  metadata: unknown,
): StyleGuide | undefined {
  const dw = getDevWorkflow(metadata);
  if (!dw) return undefined;
  const raw = dw.style_guide;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const sg = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const references = Array.isArray(sg.references)
    ? sg.references.map((r) => String(r ?? "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const tokens: Record<string, string> = {};
  if (sg.tokens && typeof sg.tokens === "object" && !Array.isArray(sg.tokens)) {
    for (const [k, v] of Object.entries(sg.tokens as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) tokens[k] = v.trim();
    }
  }
  const guide: StyleGuide = {
    domain: str(sg.domain),
    palette: str(sg.palette),
    tone: str(sg.tone),
    layout_shell: str(sg.layout_shell),
    references,
    tokens,
  };
  const hasAny =
    guide.domain ||
    guide.palette ||
    guide.tone ||
    guide.layout_shell ||
    guide.references.length ||
    Object.keys(guide.tokens).length;
  return hasAny ? guide : undefined;
}

function designTokensFromStyleGuide(
  guide: StyleGuide | undefined,
): Partial<DesignTokens> {
  if (!guide) return {};
  const out: Partial<DesignTokens> = {};
  // `palette` pode designar accent (blue/violet…) ou base neutra (zinc/slate…).
  // normalizeTokens valida cada campo de forma independente (fallback seguro).
  if (guide.palette) {
    out.accent = guide.palette;
    out.palette_base = guide.palette;
  }
  if (guide.layout_shell) out.layout_shell = guide.layout_shell;
  if (Object.keys(guide.tokens).length) out.css_vars = guide.tokens;
  return out;
}

/** Tokens de design combinados: `design_tokens` enriquecidos pelo `style_guide`. */
export function buildDesignTokensFromMetadata(
  metadata: unknown,
): Partial<DesignTokens> | undefined {
  const base = extractDesignTokensFromMetadata(metadata) ?? {};
  const fromGuide = designTokensFromStyleGuide(
    extractStyleGuideFromMetadata(metadata),
  );
  const merged: Partial<DesignTokens> = { ...base, ...fromGuide };
  return Object.keys(merged).length ? merged : undefined;
}

function touchesPackageJson(ops: DevStudioOp[]): boolean {
  return ops.some(
    (o) =>
      o.op === "write" &&
      (o.path === "package.json" || o.path.endsWith("/package.json")),
  );
}

export type ApplyDevStudioOpsContext = {
  workspacePath: string | null;
  projectTitle: string | null;
  setDevStudioProject: (workspacePath: string | null, title?: string | null) => void;
  openPlugin: (id: AppId) => void;
  /** Pedido original do utilizador (contexto para self-healing). */
  userPrompt?: string;
  /** Conversa ativa: chaveia o RAG de memória de erros por projeto no Intelligence. */
  conversationId?: string;
};

export type ApplyDevStudioOpsResult = {
  applied: boolean;
  error?: string;
  notice?: string;
  workspacePath?: string;
  title?: string | null;
};

function devLog(...args: unknown[]): void {
  if (typeof console !== "undefined") {
    console.info("[devStudio]", ...args);
  }
}

export async function applyDevStudioOpsFromMeta(
  metadata: unknown,
  ctx: ApplyDevStudioOpsContext,
): Promise<ApplyDevStudioOpsResult> {
  const normalized = normalizeDevStudioApplyMetadata(metadata);
  const meta = parseDevStudioMessageMeta(normalized);
  devLog("apply: meta parsed", {
    blocked: meta?.polvo_code_ops_blocked,
    pending: meta?.polvo_code_ops_pending,
    opsCount: meta?.polvo_code_ops?.length ?? 0,
    createProject: meta?.polvo_code_create_project,
    title: meta?.polvo_code_project_title,
    routed: meta?.routed_intent,
  });
  if (!meta || meta.polvo_code_ops_blocked) {
    devLog("apply: blocked by metadata");
    return { applied: false };
  }
  let ops = meta.polvo_code_ops ?? [];
  if (ops.length) {
    const { sanitizeDevStudioOps } = await import("@/lib/devStudio/sanitizePreviewSource");
    ops = sanitizeDevStudioOps(ops);
  }
  if (!ops.length) {
    devLog("apply: no ops to apply, returning early");
    return { applied: false };
  }

  const { isElectron } = await import("@/lib/desktopApi");
  const useNewProject =
    Boolean(meta.polvo_code_create_project) || !ctx.workspacePath?.trim();
  devLog("apply: routing", {
    isElectron: isElectron(),
    useNewProject,
    existingPath: ctx.workspacePath,
  });

  const title =
    meta.polvo_code_project_title?.trim() ||
    ctx.projectTitle?.trim() ||
    "landing-page";

  const runInstall =
    Boolean(meta.polvo_code_npm_install) || touchesPackageJson(ops) || useNewProject;

  if (!isElectron()) {
    const { applyOpsInWebContainerWithSelfHeal, isWebContainerSupported, WEBCONTAINER_WORKSPACE_ID } =
      await import("@/lib/webcontainer");

    if (!isWebContainerSupported()) {
      return {
        applied: false,
        error:
          "Preview no browser requer Cross-Origin Isolation (COOP/COEP). Use npm run dev:web e recarregue a página.",
      };
    }

    dispatchDevStudioApplyStart();
    let finishedOk = false;
    try {
      const designTokens = buildDesignTokensFromMetadata(normalized);
      const healResult = await applyOpsInWebContainerWithSelfHeal({
        ops,
        npmInstall: runInstall,
        userPrompt: ctx.userPrompt,
        designTokens,
      });
      ctx.setDevStudioProject(WEBCONTAINER_WORKSPACE_ID, title);
      ctx.openPlugin(DEV_STUDIO_NATIVE_APP_ID);
      finishedOk = true;
      const healNote = healResult.healAttempts
        ? ` Corrigido automaticamente (${healResult.healAttempts}×).`
        : "";
      return {
        applied: true,
        notice: `Preview a correr no browser (WebContainer).${healNote}`,
        workspacePath: WEBCONTAINER_WORKSPACE_ID,
        title,
      };
    } catch (e) {
      return {
        applied: false,
        error: e instanceof Error ? e.message : "Falha ao iniciar WebContainer",
      };
    } finally {
      dispatchDevStudioApplyEnd(finishedOk);
    }
  }

  dispatchDevStudioApplyStart();
  let finishedOk = false;
  try {
    const designTokens = buildDesignTokensFromMetadata(normalized);
    const { applyOpsInElectronWithSelfHeal } = await import(
      "@/lib/devStudio/electronSelfHealLoop",
    );
    const {
      devStudioWriteFilesFromOps,
      mergeProjectWithOps,
      mergedFilesToWriteOps,
    } = await import("@/lib/webcontainer/opsToFileTree");
    const { collectElectronProjectFilesForApply } = await import(
      "@/lib/devStudio/collectElectronProjectFilesForApply",
    );

    let bootstrap:
      | { title: string; files: { path: string; content: string }[] }
      | undefined;
    let electronOps: DevStudioOp[] = [];

    if (useNewProject) {
      const files = devStudioWriteFilesFromOps(ops, designTokens);
      devLog("apply: bootstrap files", { title, fileCount: files.length });
      if (!files.length) {
        return { applied: false, error: "Sem ficheiros para criar o projecto." };
      }
      bootstrap = { title, files };
    } else if (!ctx.workspacePath?.trim()) {
      return { applied: false, error: "Sem projecto activo no Estúdio." };
    } else {
      const currentFiles = await collectElectronProjectFilesForApply(
        ctx.workspacePath.trim(),
      );
      const merged = mergeProjectWithOps(currentFiles, ops, designTokens);
      electronOps = mergedFilesToWriteOps(currentFiles, merged);
      devLog("apply: merged update", {
        currentCount: Object.keys(currentFiles).length,
        mergedOps: electronOps.length,
      });
      if (!electronOps.length) {
        return { applied: false, error: "Nenhuma alteração para aplicar no projecto." };
      }
    }

    const healResult = await applyOpsInElectronWithSelfHeal({
      workspacePath: ctx.workspacePath?.trim() ?? "",
      ops: electronOps,
      runInstall,
      userPrompt: ctx.userPrompt,
      designTokens,
      conversationId: ctx.conversationId,
      bootstrapNewProject: bootstrap,
    });

    const workspacePath = healResult.workspacePath;
    ctx.setDevStudioProject(workspacePath, title);
    devLog("apply: electron self-heal ok", {
      workspacePath,
      healAttempts: healResult.healAttempts,
    });

    finishedOk = true;
    const healNote = healResult.healAttempts
      ? ` Corrigido automaticamente (${healResult.healAttempts}×).`
      : "";
    return {
      applied: true,
      notice: `Preview a actualizar com o site pedido no chat…${healNote}`,
      workspacePath,
      title,
    };
  } catch (e) {
    return {
      applied: false,
      error: e instanceof Error ? e.message : "Falha ao aplicar no preview.",
    };
  } finally {
    dispatchDevStudioApplyEnd(finishedOk);
  }
}
