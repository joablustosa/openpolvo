import { apiUrl } from "./api";

export type TaskType = "agent_prompt" | "run_task_list";

export type ScheduledTaskDTO = {
  id: string;
  name: string;
  description?: string | null;
  task_type: TaskType;
  payload: Record<string, unknown>;
  cron_expr: string;
  timezone: string;
  active: boolean;
  last_run_at?: string | null;
  last_result?: string | null;
  last_error?: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
};

export type CreateScheduledTaskInput = {
  name: string;
  description?: string;
  task_type: TaskType;
  payload: Record<string, unknown>;
  cron_expr: string;
  timezone?: string;
  active?: boolean;
};

export type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput>;

export async function listScheduledTasks(): Promise<ScheduledTaskDTO[]> {
  const r = await fetch(apiUrl("/v1/scheduled-tasks"), { credentials: "include" });
  if (!r.ok) throw new Error(`Erro ao listar automações: ${r.status}`);
  return r.json();
}

export async function getScheduledTask(id: string): Promise<ScheduledTaskDTO> {
  const r = await fetch(apiUrl(`/v1/scheduled-tasks/${id}`), { credentials: "include" });
  if (!r.ok) throw new Error(`Automação não encontrada: ${r.status}`);
  return r.json();
}

export async function createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTaskDTO> {
  const r = await fetch(apiUrl("/v1/scheduled-tasks"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erro ao criar automação: ${r.status}`);
  }
  return r.json();
}

export async function updateScheduledTask(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTaskDTO> {
  const r = await fetch(apiUrl(`/v1/scheduled-tasks/${id}`), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erro ao actualizar automação: ${r.status}`);
  }
  return r.json();
}

export async function deleteScheduledTask(id: string): Promise<void> {
  const r = await fetch(apiUrl(`/v1/scheduled-tasks/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!r.ok) throw new Error(`Erro ao apagar automação: ${r.status}`);
}

export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const days: Record<string, string> = {
    "0": "dom", "1": "seg", "2": "ter", "3": "qua", "4": "qui", "5": "sex", "6": "sáb",
  };
  if (dom === "*" && dow === "*") {
    if (min === "0" && /^\d+$/.test(hour)) return `todos os dias às ${hour.padStart(2, "0")}:00`;
    if (min.startsWith("*/")) return `a cada ${min.slice(2)} minutos`;
    if (min === "0" && hour === "*") return "a cada hora";
  }
  if (dom === "*" && /^\d+$/.test(dow)) {
    const d = days[dow] || dow;
    if (min === "0" && /^\d+$/.test(hour)) return `toda ${d} às ${hour.padStart(2, "0")}:00`;
  }
  if (dom === "*" && dow.includes("-")) {
    if (min === "0" && /^\d+$/.test(hour)) return `dias úteis às ${hour.padStart(2, "0")}:00`;
  }
  return expr;
}
