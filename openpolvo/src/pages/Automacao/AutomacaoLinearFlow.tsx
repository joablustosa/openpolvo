/**
 * Pipeline visual linear para tarefas agendadas (ScheduledTask).
 *
 * Mostra um grafo horizontal de 2-3 nós:
 *   [⏰ Disparo CRON] → [🤖 Agente / 📋 Lista] → [📧 Email?]
 *
 * Cores por estado:
 *  - Cinzento  : nunca executado (idle)
 *  - Azul pulsante : em execução (running)
 *  - Verde     : sucesso
 *  - Vermelho  : erro (com tooltip da mensagem)
 *  - Transparente  : passo ignorado (ex: email desactivado)
 */
import { Bot, CheckCircle2, Clock, ListTodo, Loader2, Mail, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduledTaskDTO } from "@/lib/scheduleApi";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type StepStatus = "idle" | "running" | "success" | "error" | "skipped";

type Step = {
  id: string;
  icon: "clock" | "bot" | "list" | "mail";
  label: string;
  sublabel?: string;
  status: StepStatus;
  /** Mensagem de erro ou resultado resumido */
  message?: string;
};

// ── Lógica de construção dos passos ───────────────────────────────────────────

export function buildTaskSteps(task: ScheduledTaskDTO, running: boolean): Step[] {
  const hasRun = Boolean(task.last_run_at);
  const hasError = Boolean(task.last_error);
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const sendEmail = Boolean(payload.send_email);
  const isList = task.task_type === "run_task_list";

  // Tenta determinar em que passo ocorreu o erro
  const errLower = (task.last_error ?? "").toLowerCase();
  const emailFailed = hasError && (errLower.includes("email") || errLower.includes("smtp") || errLower.includes("mail"));
  const agentFailed = hasError && !emailFailed;

  const cronStatus: StepStatus = running || hasRun ? "success" : "idle";

  let agentStatus: StepStatus;
  if (running) agentStatus = "running";
  else if (!hasRun) agentStatus = "idle";
  else if (agentFailed) agentStatus = "error";
  else agentStatus = "success";

  let emailStatus: StepStatus;
  if (!sendEmail) emailStatus = "skipped";
  else if (!hasRun || agentFailed) emailStatus = "idle";
  else if (running) emailStatus = "idle";
  else if (emailFailed) emailStatus = "error";
  else emailStatus = "success";

  const steps: Step[] = [
    {
      id: "cron",
      icon: "clock",
      label: "Disparo CRON",
      sublabel: task.cron_expr,
      status: cronStatus,
    },
    {
      id: "action",
      icon: isList ? "list" : "bot",
      label: isList ? "Execução da Lista" : "Execução do Agente",
      sublabel: running ? "A executar…" : undefined,
      status: agentStatus,
      message: agentFailed
        ? (task.last_error ?? undefined)
        : agentStatus === "success"
          ? (task.last_result ? task.last_result.slice(0, 120) : undefined)
          : undefined,
    },
  ];

  if (sendEmail) {
    steps.push({
      id: "email",
      icon: "mail",
      label: "Envio de Email",
      status: emailStatus,
      message: emailFailed ? (task.last_error ?? undefined) : undefined,
    });
  }

  return steps;
}

// ── Ícone do passo ─────────────────────────────────────────────────────────────

function StepIcon({ icon, status }: { icon: Step["icon"]; status: StepStatus }) {
  const base = "size-5 shrink-0";
  if (status === "running") return <Loader2 className={cn(base, "animate-spin text-blue-500")} />;
  if (status === "success") {
    const colors: Record<Step["icon"], string> = {
      clock: "text-violet-500",
      bot: "text-emerald-500",
      list: "text-emerald-500",
      mail: "text-emerald-500",
    };
    return <CheckCircle2 className={cn(base, colors[icon])} />;
  }
  if (status === "error") return <XCircle className={cn(base, "text-red-500")} />;

  // idle / skipped — mostra o ícone tipo
  const iconEl: Record<Step["icon"], React.ReactNode> = {
    clock: <Clock className={cn(base, "text-violet-400 dark:text-violet-500")} />,
    bot: <Bot className={cn(base, "text-muted-foreground")} />,
    list: <ListTodo className={cn(base, "text-muted-foreground")} />,
    mail: <Mail className={cn(base, "text-amber-400 dark:text-amber-500")} />,
  };
  return <>{iconEl[icon]}</>;
}

// ── Nó individual ──────────────────────────────────────────────────────────────

function StepNode({ step }: { step: Step }) {
  const containerClass = cn(
    "relative flex flex-col items-center gap-2 rounded-xl border-2 px-5 py-4 min-w-[130px] max-w-[180px] text-center transition-all duration-300",
    step.status === "running" &&
      "border-blue-500 bg-blue-500/8 shadow-lg shadow-blue-500/20 animate-[pulse_2s_ease-in-out_infinite]",
    step.status === "success" && "border-emerald-500 bg-emerald-500/6",
    step.status === "error" && "border-red-500 bg-red-500/8",
    step.status === "idle" && "border-border bg-card",
    step.status === "skipped" && "border-dashed border-border/40 bg-muted/15 opacity-50",
  );

  return (
    <div className={containerClass} title={step.message}>
      <StepIcon icon={step.icon} status={step.status} />
      <div className="space-y-0.5">
        <p
          className={cn(
            "text-[11px] font-semibold leading-tight",
            step.status === "error" && "text-red-700 dark:text-red-400",
            step.status === "success" && "text-foreground",
            step.status === "running" && "text-blue-700 dark:text-blue-300",
            (step.status === "idle" || step.status === "skipped") && "text-muted-foreground",
          )}
        >
          {step.label}
        </p>
        {step.sublabel ? (
          <p className="font-mono text-[9px] text-muted-foreground/70 truncate max-w-[140px]">
            {step.sublabel}
          </p>
        ) : null}
        {step.message ? (
          <p
            className={cn(
              "mt-1 max-w-[140px] truncate text-[9px] leading-snug",
              step.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
            )}
            title={step.message}
          >
            {step.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Conector (seta entre nós) ──────────────────────────────────────────────────

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-0">
      <div className={cn("h-px w-8 md:w-12 transition-colors", active ? "bg-emerald-400" : "bg-border/60")} />
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className={cn("shrink-0 transition-colors", active ? "text-emerald-400" : "text-border/60")}
      >
        <path d="M0 0 L10 5 L0 10 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

interface AutomacaoLinearFlowProps {
  task: ScheduledTaskDTO;
  running?: boolean;
}

export function AutomacaoLinearFlow({ task, running = false }: AutomacaoLinearFlowProps) {
  const steps = buildTaskSteps(task, running);

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex flex-wrap items-center justify-center gap-0">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center">
            {i > 0 ? (
              <Arrow active={steps[i - 1].status === "success"} />
            ) : null}
            <StepNode step={step} />
          </div>
        ))}
      </div>
    </div>
  );
}
