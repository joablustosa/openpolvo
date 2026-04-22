/** Metadados do Intelligence para aplicar operações sobre listas de tarefas (POST /v1/task-lists/batch). */

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

/** Indica resposta do assistente ligada a listas de tarefas (abrir preview ao lado do chat). */
export function messageIndicatesTaskListInteraction(metadata: unknown): boolean {
  const m = metaRecord(metadata);
  if (!m) return false;
  const routed = String(m.routed_intent ?? "").trim();
  if (routed === "gestao_tarefas_calendario") return true;
  const tm = parseTaskListMessageMeta(metadata);
  if (tm?.task_list_ops_pending) return true;
  if (tm?.task_list_ops && tm.task_list_ops.length > 0) return true;
  return false;
}

export type TaskListOpRecord = Record<string, unknown>;

export type ParsedTaskListMessageMeta = {
  task_list_ops_pending?: boolean;
  task_list_ops_blocked?: boolean;
  task_list_ops_errors?: string[];
  task_list_ops?: TaskListOpRecord[];
};

export function parseTaskListMessageMeta(
  metadata: unknown,
): ParsedTaskListMessageMeta | null {
  const m = metaRecord(metadata);
  if (!m) return null;
  const opsRaw = m.task_list_ops;
  const ops: TaskListOpRecord[] = [];
  if (Array.isArray(opsRaw)) {
    for (const row of opsRaw) {
      if (row && typeof row === "object") {
        ops.push(row as TaskListOpRecord);
      }
    }
  }
  const errRaw = m.task_list_ops_errors;
  const errs: string[] = [];
  if (Array.isArray(errRaw)) {
    for (const e of errRaw) {
      if (typeof e === "string" && e.trim()) errs.push(e.trim());
    }
  }
  return {
    task_list_ops_pending: Boolean(m.task_list_ops_pending),
    task_list_ops_blocked: Boolean(m.task_list_ops_blocked),
    task_list_ops_errors: errs.length ? errs : undefined,
    task_list_ops: ops.length ? ops : undefined,
  };
}
