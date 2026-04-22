/** Metadados do Intelligence para aplicar operações sobre tarefas agendadas. */

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

export type SchedOpRecord = Record<string, unknown>;

export type ParsedSchedMessageMeta = {
  scheduled_task_ops_pending?: boolean;
  scheduled_task_ops_blocked?: boolean;
  scheduled_task_ops_errors?: string[];
  scheduled_task_ops?: SchedOpRecord[];
};

export function parseSchedMessageMeta(metadata: unknown): ParsedSchedMessageMeta | null {
  const m = metaRecord(metadata);
  if (!m) return null;
  const opsRaw = m.scheduled_task_ops;
  const ops: SchedOpRecord[] = [];
  if (Array.isArray(opsRaw)) {
    for (const row of opsRaw) {
      if (row && typeof row === "object") ops.push(row as SchedOpRecord);
    }
  }
  const errRaw = m.scheduled_task_ops_errors;
  const errs: string[] = [];
  if (Array.isArray(errRaw)) {
    for (const e of errRaw) {
      if (typeof e === "string" && e.trim()) errs.push(e.trim());
    }
  }
  return {
    scheduled_task_ops_pending: Boolean(m.scheduled_task_ops_pending),
    scheduled_task_ops_blocked: Boolean(m.scheduled_task_ops_blocked),
    scheduled_task_ops_errors: errs.length ? errs : undefined,
    scheduled_task_ops: ops.length ? ops : undefined,
  };
}

export function messageIndicatesSchedInteraction(metadata: unknown): boolean {
  const m = metaRecord(metadata);
  if (!m) return false;
  if (String(m.routed_intent ?? "").trim() === "agendamento") return true;
  const sm = parseSchedMessageMeta(metadata);
  if (sm?.scheduled_task_ops_pending) return true;
  if (sm?.scheduled_task_ops && sm.scheduled_task_ops.length > 0) return true;
  return false;
}
