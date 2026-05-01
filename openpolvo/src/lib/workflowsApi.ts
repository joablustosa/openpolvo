import { apiUrl } from "./api";
import type { ModelProvider } from "./conversationsApi";

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowNode = {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data: {
    url?: string;
    selector?: string;
    value?: string;
    prompt?: string;
    timeout_ms?: number;
    label?: string;
    // web_search (SerpApi DuckDuckGo)
    query?: string;
    kl?: string;
    df?: string;
    safe?: number;
    start?: number;
    m?: number;
    /** SerpApi: "duckduckgo" (omissão) ou "google" */
    search_engine?: string;
    /** Cron de 5 campos (min hora dom mês dow), ex.: 0 9 * * * */
    cron?: string;
    /** IANA, ex.: Europe/Lisbon */
    timezone?: string;
    schedule_enabled?: boolean;
    /** E-mail(s) directo(s) do destinatário — tem prioridade sobre contact_id */
    email_to?: string;
    contact_id?: string;
    email_subject?: string;
    email_body?: string;
    /** post_*: legenda/corpo; {{previous}} / {{output:ID}} */
    caption?: string;
    image_url?: string;
    video_url?: string;
    link_url?: string;
    whatsapp_to?: string;
    /** YouTube: short | long */
    youtube_format?: string;
    /** Metadado UI (cadência real = cron do nó schedule) */
    posts_per_day?: number;
  };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

export type WorkflowDTO = {
  id: string;
  title: string;
  graph: WorkflowGraph;
  pinned_at?: string | null;
  schedule_cron?: string | null;
  schedule_timezone?: string;
  schedule_enabled?: boolean;
  schedule_last_fired_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowRunDTO = {
  id: string;
  workflow_id: string;
  status: string;
  step_log?: { node_id: string; type: string; ok: boolean; message?: string }[];
  error_message?: string | null;
  created_at: string;
  finished_at?: string | null;
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchWorkflows(token: string): Promise<WorkflowDTO[]> {
  const res = await fetch(apiUrl("/v1/workflows"), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`workflows: ${res.status}`);
  return res.json() as Promise<WorkflowDTO[]>;
}

export async function getWorkflow(
  token: string,
  id: string,
): Promise<WorkflowDTO> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}`), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`workflow: ${res.status}`);
  return res.json() as Promise<WorkflowDTO>;
}

export async function createWorkflow(
  token: string,
  body: { title: string; graph: WorkflowGraph },
): Promise<WorkflowDTO> {
  const res = await fetch(apiUrl("/v1/workflows"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create workflow: ${res.status}`);
  return res.json() as Promise<WorkflowDTO>;
}

export async function updateWorkflow(
  token: string,
  id: string,
  body: { title?: string; graph?: WorkflowGraph },
): Promise<WorkflowDTO> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}`), {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update workflow: ${res.status}`);
  return res.json() as Promise<WorkflowDTO>;
}

export async function pinWorkflow(
  token: string,
  id: string,
  pinned: boolean,
): Promise<WorkflowDTO> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}/pin`), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error(`pin workflow: ${res.status}`);
  return res.json() as Promise<WorkflowDTO>;
}

export async function deleteWorkflow(
  token: string,
  id: string,
): Promise<void> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}`), {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`delete workflow: ${res.status}`);
}

export async function runWorkflow(
  token: string,
  id: string,
): Promise<WorkflowRunDTO> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}/run`), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`run workflow: ${res.status}`);
  return res.json() as Promise<WorkflowRunDTO>;
}

export async function fetchWorkflowRuns(
  token: string,
  id: string,
): Promise<WorkflowRunDTO[]> {
  const res = await fetch(apiUrl(`/v1/workflows/${id}/runs`), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`workflow runs: ${res.status}`);
  return res.json() as Promise<WorkflowRunDTO[]>;
}

export type GenerateResponse = {
  graph: WorkflowGraph;
  raw_llm: string;
  saved?: WorkflowDTO;
};

export async function generateWorkflow(
  token: string,
  body: {
    prompt: string;
    recording_json?: string;
    model_provider?: ModelProvider;
    llm_profile_id?: string;
    save_title?: string;
  },
): Promise<GenerateResponse> {
  const res = await fetch(apiUrl("/v1/workflows/generate"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (res.status === 422) {
    const err = (await res.json()) as { error?: string; raw_llm?: string };
    const msg = err.error ?? "JSON inválido do modelo";
    if (err.raw_llm) {
      throw new Error(`${msg}\n\nResposta bruta:\n${err.raw_llm.slice(0, 2000)}`);
    }
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(`generate: ${res.status}`);
  return res.json() as Promise<GenerateResponse>;
}
