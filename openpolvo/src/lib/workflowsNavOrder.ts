import type { WorkflowDTO } from "@/lib/workflowsApi";

function timeMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Alinhado ao ORDER BY da API: fixados primeiro, depois por updated_at. */
export function partitionWorkflowsForNav(workflows: WorkflowDTO[]): {
  pinned: WorkflowDTO[];
  recent: WorkflowDTO[];
} {
  const pinned = workflows
    .filter((w) => Boolean(w.pinned_at))
    .sort((a, b) => timeMs(b.pinned_at) - timeMs(a.pinned_at));

  const recent = workflows
    .filter((w) => !w.pinned_at)
    .sort((a, b) => timeMs(b.updated_at) - timeMs(a.updated_at));

  return { pinned, recent };
}
