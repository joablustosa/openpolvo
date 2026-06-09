/**
 * API tipada do backend Go para hidratar o projecto Dev Studio de uma conversa.
 *
 * Endpoints (contrato com openpolvobackend):
 * - GET  /v1/conversations/{id}/project   → { project | null }
 * - GET  /v1/projects/{id}                 → { project, files[] }
 * - GET  /v1/projects/{id}/versions        → { versions[] }
 * - POST /v1/projects/{id}/rollback        → { project, files[] }
 */

import { fetchApi } from "@/lib/api";
import { ApiError } from "@/lib/apiErrors";

export type DevStudioProject = {
  id: string;
  conversation_id: string;
  title: string | null;
  kind: string | null;
  stack: string | null;
  latest_version_seq: number | null;
  updated_at: string | null;
};

export type DevStudioProjectFile = {
  path: string;
  content: string;
};

export type DevStudioProjectVersion = {
  id: string;
  seq: number;
  summary: string | null;
  created_at: string | null;
};

export type DevStudioProjectWithFiles = {
  project: DevStudioProject;
  files: DevStudioProjectFile[];
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseProject(raw: unknown): DevStudioProject | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r.id).trim();
  if (!id) return null;
  return {
    id,
    conversation_id: str(r.conversation_id).trim(),
    title: strOrNull(r.title),
    kind: strOrNull(r.kind),
    stack: strOrNull(r.stack),
    latest_version_seq: numOrNull(r.latest_version_seq),
    updated_at: strOrNull(r.updated_at),
  };
}

function parseFiles(raw: unknown): DevStudioProjectFile[] {
  if (!Array.isArray(raw)) return [];
  const out: DevStudioProjectFile[] = [];
  for (const row of raw) {
    const r = asRecord(row);
    if (!r) continue;
    const path = str(r.path).trim();
    if (!path) continue;
    out.push({ path: path.replace(/\\/g, "/"), content: str(r.content) });
  }
  return out;
}

function parseVersions(raw: unknown): DevStudioProjectVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: DevStudioProjectVersion[] = [];
  for (const row of raw) {
    const r = asRecord(row);
    if (!r) continue;
    const id = str(r.id).trim();
    const seq = numOrNull(r.seq);
    if (!id || seq === null) continue;
    out.push({
      id,
      seq,
      summary: strOrNull(r.summary),
      created_at: strOrNull(r.created_at),
    });
  }
  return out;
}

async function jsonOrThrow(res: Response, label: string): Promise<unknown> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = strOrNull((err as { error?: string }).error) ?? `${label} (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<unknown>;
}

/** Projecto associado à conversa (ou null se ainda não existir). */
export async function fetchConversationProject(
  token: string,
  conversationId: string,
): Promise<DevStudioProject | null> {
  const id = conversationId.trim();
  if (!id) return null;
  const res = await fetchApi(`/v1/conversations/${id}/project`, {
    headers: headersJson(token),
  });
  if (res.status === 404) return null;
  const data = asRecord(await jsonOrThrow(res, "projecto da conversa"));
  if (!data) return null;
  return parseProject(data.project);
}

/** Projecto + ficheiros da última versão. */
export async function fetchProjectWithFiles(
  token: string,
  projectId: string,
): Promise<DevStudioProjectWithFiles | null> {
  const id = projectId.trim();
  if (!id) return null;
  const res = await fetchApi(`/v1/projects/${id}`, {
    headers: headersJson(token),
  });
  if (res.status === 404) return null;
  const data = asRecord(await jsonOrThrow(res, "projecto"));
  if (!data) return null;
  const project = parseProject(data.project);
  if (!project) return null;
  return { project, files: parseFiles(data.files) };
}

/** Histórico de versões do projecto. */
export async function fetchProjectVersions(
  token: string,
  projectId: string,
): Promise<DevStudioProjectVersion[]> {
  const id = projectId.trim();
  if (!id) return [];
  const res = await fetchApi(`/v1/projects/${id}/versions`, {
    headers: headersJson(token),
  });
  if (res.status === 404) return [];
  const data = asRecord(await jsonOrThrow(res, "versões do projecto"));
  if (!data) return [];
  return parseVersions(data.versions);
}

/** Reverte o projecto para a versão `seq` e devolve o estado restaurado. */
export async function rollbackProject(
  token: string,
  projectId: string,
  seq: number,
): Promise<DevStudioProjectWithFiles | null> {
  const id = projectId.trim();
  if (!id) return null;
  const res = await fetchApi(`/v1/projects/${id}/rollback`, {
    method: "POST",
    headers: { ...headersJson(token), "Content-Type": "application/json" },
    body: JSON.stringify({ seq }),
  });
  const data = asRecord(await jsonOrThrow(res, "rollback do projecto"));
  if (!data) return null;
  const project = parseProject(data.project);
  if (!project) return null;
  return { project, files: parseFiles(data.files) };
}

/** Converte os ficheiros do backend num mapa plano path → conteúdo. */
export function projectFilesToRecord(
  files: readonly DevStudioProjectFile[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const path = f.path.trim().replace(/\\/g, "/");
    if (path) out[path] = f.content;
  }
  return out;
}
