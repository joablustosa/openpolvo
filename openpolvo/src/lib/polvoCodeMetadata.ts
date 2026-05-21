/**
 * Metadados do Intelligence para aplicar operações no workspace Polvo Code (Electron).
 * Alinhado com a validação em `openpolvointeligence.graphs.polvo_code_metadata`.
 *
 * Importação de `desktopApi` é feita só dentro de `applyPolvoCodeOpsFromMeta` (dynamic import)
 * para evitar ciclos de módulos no arranque do renderer Electron.
 */

import type { AppId } from "@/config/apps";
import {
  dispatchPolvoCodeApplyEnd,
  dispatchPolvoCodeApplyStart,
} from "@/lib/polvoCodeApplyEvents";

export type PolvoCodeOpKind = "write" | "mkdir";

export type PolvoCodeOp = {
  op: PolvoCodeOpKind;
  path: string;
  /** Obrigatório para `write`; ignorado em `mkdir`. */
  content?: string;
};

export type ParsedPolvoCodeMessageMeta = {
  polvo_code_ops_pending?: boolean;
  polvo_code_ops_blocked?: boolean;
  polvo_code_ops_errors?: string[];
  polvo_code_ops?: PolvoCodeOp[];
  polvo_code_create_project?: boolean;
  polvo_code_project_title?: string;
  polvo_code_npm_install?: boolean;
};

/** Re-export para compatibilidade com módulos que importam a partir deste ficheiro. */
export {
  POLVO_CODE_APPLY_END,
  POLVO_CODE_APPLY_START,
} from "@/lib/polvoCodeApplyEvents";

function metaRecord(metadata: unknown): Record<string, unknown> | null {
  let raw: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      raw = JSON.parse(metadata) as unknown;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function messageIndicatesPolvoCodeInteraction(metadata: unknown): boolean {
  const m = metaRecord(metadata);
  if (!m) return false;
  const routed = String(m.routed_intent ?? "").trim();
  if (routed === "polvo_code_builder") return true;
  const p = parsePolvoCodeMessageMeta(metadata);
  if (p?.polvo_code_ops_pending) return true;
  if (p?.polvo_code_ops && p.polvo_code_ops.length > 0) return true;
  return false;
}

export function parsePolvoCodeMessageMeta(
  metadata: unknown,
): ParsedPolvoCodeMessageMeta | null {
  const m = metaRecord(metadata);
  if (!m) return null;
  const opsRaw = m.polvo_code_ops;
  const ops: PolvoCodeOp[] = [];
  if (Array.isArray(opsRaw)) {
    for (const row of opsRaw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const op = String(r.op ?? "").trim().toLowerCase();
      if (op !== "write" && op !== "mkdir") continue;
      const path = String(r.path ?? "").trim().replace(/\\/g, "/");
      if (!path || path.includes("..")) continue;
      const content = typeof r.content === "string" ? r.content : undefined;
      ops.push({
        op: op as PolvoCodeOpKind,
        path,
        content: op === "write" ? content ?? "" : undefined,
      });
    }
  }
  const errRaw = m.polvo_code_ops_errors;
  const errs: string[] = [];
  if (Array.isArray(errRaw)) {
    for (const e of errRaw) {
      if (typeof e === "string" && e.trim()) errs.push(e.trim());
    }
  }
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
  };
}

const MAX_CLIENT_WRITE_UTF8 = 512 * 1024;

function touchesPackageJson(ops: PolvoCodeOp[]): boolean {
  return ops.some(
    (o) =>
      o.op === "write" &&
      o.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === "package.json",
  );
}

export type ApplyPolvoCodeOpsContext = {
  workspacePath: string | null;
  projectTitle: string | null;
  setPolvoCodeProject: (workspacePath: string | null, title?: string | null) => void;
  openPlugin: (id: AppId) => void;
};

/**
 * Aplica `polvo_code_ops` no disco (Electron). Em projecto novo ou sem workspace,
 * usa `writeProject`; caso contrário aplica mkdir/write sequencialmente.
 */
export async function applyPolvoCodeOpsFromMeta(
  metadata: unknown,
  ctx: ApplyPolvoCodeOpsContext,
): Promise<{ applied: boolean; error?: string; notice?: string }> {
  const meta = parsePolvoCodeMessageMeta(metadata);
  if (!meta?.polvo_code_ops_pending || meta.polvo_code_ops_blocked) {
    return { applied: false };
  }
  const ops = meta.polvo_code_ops ?? [];
  if (!ops.length) return { applied: false };

  const { desktopPolvoCode, isElectron } = await import("@/lib/desktopApi");
  if (!isElectron()) {
    return { applied: false, error: "Polvo Code só está disponível na app desktop." };
  }

  for (const o of ops) {
    if (o.op === "write") {
      const n = new TextEncoder().encode(o.content ?? "").length;
      if (n > MAX_CLIENT_WRITE_UTF8) {
        return {
          applied: false,
          error: `Ficheiro demasiado grande: ${o.path} (${n} bytes).`,
        };
      }
    }
  }

  const useNewProject =
    Boolean(meta.polvo_code_create_project) || !ctx.workspacePath?.trim();

  dispatchPolvoCodeApplyStart();
  let finishedOk = false;
  try {
    ctx.openPlugin("polvo_code");

    let workspacePath = ctx.workspacePath?.trim() ?? "";
    const title =
      meta.polvo_code_project_title?.trim() ||
      ctx.projectTitle?.trim() ||
      "project";

    const wantNpm =
      Boolean(meta.polvo_code_npm_install) || touchesPackageJson(ops) || useNewProject;

    if (useNewProject) {
      const files = ops
        .filter((o) => o.op === "write")
        .map((o) => ({ path: o.path, content: o.content ?? "" }));
      if (!files.length) {
        return { applied: false, error: "Sem ficheiros write para criar o projecto." };
      }
      const wpRes = await desktopPolvoCode.writeProject({ title, files });
      if (!wpRes.ok || !wpRes.workspacePath) {
        return { applied: false, error: wpRes.error ?? "writeProject falhou." };
      }
      workspacePath = wpRes.workspacePath;
      ctx.setPolvoCodeProject(workspacePath, title);
      for (const o of ops) {
        if (o.op === "mkdir") {
          const mr = await desktopPolvoCode.mkdir({
            workspacePath,
            relPath: o.path,
          });
          if (!mr.ok) {
            return { applied: false, error: mr.error ?? `mkdir ${o.path}` };
          }
        }
      }
    } else {
      for (const o of ops) {
        if (o.op === "mkdir") {
          const mr = await desktopPolvoCode.mkdir({
            workspacePath,
            relPath: o.path,
          });
          if (!mr.ok) {
            return { applied: false, error: mr.error ?? `mkdir ${o.path}` };
          }
        } else {
          const wr = await desktopPolvoCode.writeFile({
            workspacePath,
            relPath: o.path,
            content: o.content ?? "",
            createDirs: true,
          });
          if (!wr.ok) {
            return { applied: false, error: wr.error ?? `write ${o.path}` };
          }
        }
      }
    }

    if (wantNpm) {
      const ir = await desktopPolvoCode.npmInstall(workspacePath);
      if (!ir.ok && ir.error) {
        finishedOk = true;
        return {
          applied: true,
          error: `Ficheiros aplicados; npm install: ${ir.error}`,
          notice: "Projecto actualizado; verifica o terminal do Polvo Code.",
        };
      }
    }

    if (useNewProject || wantNpm) {
      await desktopPolvoCode.devStart({
        workspacePath,
        port: 5175,
        openBrowser: false,
      });
    }

    finishedOk = true;
    return {
      applied: true,
      notice: useNewProject
        ? "Novo projecto criado no Polvo Code; preview a arrancar."
        : "Ficheiros actualizados no Polvo Code.",
    };
  } finally {
    dispatchPolvoCodeApplyEnd(finishedOk);
  }
}
