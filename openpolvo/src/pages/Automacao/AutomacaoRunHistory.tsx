/**
 * Painel de histórico de execuções — mostra os últimos runs de uma automação
 * com o log por passo (em que parte do processo ocorreu o erro/sucesso).
 *
 * Para ScheduledTask: constrói um histórico sintético a partir de last_run_at/
 * last_error/last_result (o backend não guarda runs individuais para tasks).
 *
 * Para Workflow: usa WorkflowRunDTO[] com step_log real.
 */
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { buildTaskSteps, type StepStatus } from "./AutomacaoLinearFlow";
import type { ScheduledTaskDTO } from "@/lib/scheduleApi";
import type { WorkflowRunDTO } from "@/lib/workflowsApi";

// ── Tipos internos ─────────────────────────────────────────────────────────────

type HistoryStep = {
  id: string;
  label: string;
  ok: boolean;
  running?: boolean;
  message?: string;
};

type HistoryEntry = {
  id: string;
  runAt: string;
  finishedAt?: string | null;
  status: "success" | "error" | "running";
  steps: HistoryStep[];
};

// ── Conversor ScheduledTask → HistoryEntry ────────────────────────────────────

function taskToHistoryEntry(task: ScheduledTaskDTO, running: boolean): HistoryEntry | null {
  if (!task.last_run_at && !running) return null;

  const steps = buildTaskSteps(task, running);
  const stepsMapped: HistoryStep[] = steps
    .filter((s) => s.status !== "skipped")
    .map((s) => ({
      id: s.id,
      label: s.label,
      ok: s.status === "success",
      running: s.status === "running",
      message: s.message,
    }));

  const status: HistoryEntry["status"] = running
    ? "running"
    : task.last_error
      ? "error"
      : "success";

  return {
    id: "last",
    runAt: running ? new Date().toISOString() : (task.last_run_at ?? new Date().toISOString()),
    status,
    steps: stepsMapped,
  };
}

// ── Conversor WorkflowRunDTO → HistoryEntry ───────────────────────────────────

function wfRunToHistoryEntry(run: WorkflowRunDTO): HistoryEntry {
  const steps: HistoryStep[] = (run.step_log ?? []).map((s) => ({
    id: s.node_id,
    label: `${s.type}${s.node_id !== s.type ? ` (${s.node_id.slice(0, 6)})` : ""}`,
    ok: s.ok,
    message: s.message,
  }));

  // Se o erro principal não está no step_log, adiciona passo sintético
  if (run.status === "error" && run.error_message && steps.every((s) => s.ok)) {
    steps.push({ id: "error", label: "Erro geral", ok: false, message: run.error_message });
  }

  return {
    id: run.id,
    runAt: run.created_at,
    finishedAt: run.finished_at,
    status: run.status === "running" ? "running" : run.status === "error" ? "error" : "success",
    steps,
  };
}

// ── Componentes visuais ────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: HistoryEntry["status"] }) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  return <XCircle className="size-3.5 text-red-500" />;
}

function StepStatusIcon({ ok, running }: { ok: boolean; running?: boolean }) {
  if (running) return <Loader2 className="size-3 animate-spin text-blue-500" />;
  if (ok) return <CheckCircle2 className="size-3 text-emerald-500" />;
  return <XCircle className="size-3 text-red-500" />;
}

function stepStatusFor(s: StepStatus): boolean {
  return s === "success";
}
void stepStatusFor; // usado externamente

function HistoryEntryRow({ entry, index }: { entry: HistoryEntry; index: number }) {
  const [open, setOpen] = useState(index === 0); // primeiro expandido por defeito

  const runAt = new Date(entry.runAt);
  const dateStr = runAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const timeStr = runAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const duration =
    entry.finishedAt
      ? Math.round(
          (new Date(entry.finishedAt).getTime() - runAt.getTime()) / 1000,
        ) + "s"
      : null;

  const successCount = entry.steps.filter((s) => s.ok).length;
  const totalCount = entry.steps.length;

  return (
    <div
      className={cn(
        "rounded-lg border text-xs transition-colors",
        entry.status === "running" && "border-blue-500/50 bg-blue-500/4",
        entry.status === "success" && "border-emerald-500/30 bg-emerald-500/3",
        entry.status === "error" && "border-red-500/30 bg-red-500/4",
      )}
    >
      {/* Cabeçalho do run */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <StatusIcon status={entry.status} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            <Clock className="size-3" />
            {dateStr} {timeStr}
          </span>
          {duration ? (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
              {duration}
            </span>
          ) : null}
          <span
            className={cn(
              "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              entry.status === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              entry.status === "error" && "bg-red-500/10 text-red-700 dark:text-red-400",
              entry.status === "running" && "bg-blue-500/10 text-blue-700 dark:text-blue-400",
            )}
          >
            {entry.status === "running"
              ? "em execução"
              : entry.status === "success"
                ? "sucesso"
                : `erro · ${successCount}/${totalCount} passos`}
          </span>
        </div>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Log de passos */}
      {open && entry.steps.length > 0 ? (
        <div className="border-t border-border/50 px-3 pb-2.5 pt-2">
          <div className="space-y-1.5">
            {entry.steps.map((step, i) => (
              <div key={step.id} className="flex items-start gap-2">
                {/* Linha vertical conectora */}
                <div className="relative flex flex-col items-center">
                  <StepStatusIcon ok={step.ok} running={step.running} />
                  {i < entry.steps.length - 1 ? (
                    <div className="mt-1 h-full min-h-[12px] w-px bg-border/60" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 pb-1">
                  <span
                    className={cn(
                      "font-medium",
                      step.running && "text-blue-700 dark:text-blue-300",
                      !step.ok && !step.running && "text-red-700 dark:text-red-400",
                      step.ok && "text-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.message ? (
                    <p
                      className={cn(
                        "mt-0.5 break-words text-[10px] leading-snug",
                        !step.ok && !step.running ? "text-red-600/80 dark:text-red-400/80" : "text-muted-foreground",
                      )}
                    >
                      {step.message}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Componente público ─────────────────────────────────────────────────────────

interface AutomacaoRunHistoryProps {
  kind: "task" | "workflow";
  task?: ScheduledTaskDTO;
  wfRuns?: WorkflowRunDTO[];
  running?: boolean;
  loadingRuns?: boolean;
}

export function AutomacaoRunHistory({
  kind,
  task,
  wfRuns,
  running = false,
  loadingRuns = false,
}: AutomacaoRunHistoryProps) {
  const entries: HistoryEntry[] = [];

  if (kind === "task" && task) {
    const entry = taskToHistoryEntry(task, running);
    if (entry) entries.push(entry);
    // Se nunca correu, entries ficará vazio
  } else if (kind === "workflow" && wfRuns) {
    for (const run of wfRuns.slice(0, 5)) {
      entries.push(wfRunToHistoryEntry(run));
    }
    // Injectar estado "running" se necessário (a correr agora)
    if (running && (entries.length === 0 || entries[0].status !== "running")) {
      entries.unshift({
        id: "running-now",
        runAt: new Date().toISOString(),
        status: "running",
        steps: [],
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Histórico de execuções
        </span>
        {loadingRuns ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
        {entries.length > 0 ? (
          <span className="ml-auto text-[10px] text-muted-foreground">{entries.length} run{entries.length !== 1 ? "s" : ""}</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 && !loadingRuns ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Clock className="size-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Ainda sem execuções</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, i) => (
              <HistoryEntryRow key={entry.id} entry={entry} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
