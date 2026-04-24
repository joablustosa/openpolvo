/**
 * Página unificada de Automação.
 *
 * Une "Automações agendadas" (ScheduledTask) e Workflows num só ecrã:
 *
 *  ┌──────────────────┬───────────────────────────────────────┬─────────────┐
 *  │  Lista unificada │  Grafo visual (execução ou editor)    │  Painel Dir │
 *  │  (tarefas +      │  • exec: linear/XYFlow só-leitura     │  • task form│
 *  │   workflows)     │  • edit: XYFlow editável + inspector  │  • wf insp. │
 *  │                  ├───────────────────────────────────────┤             │
 *  │                  │  Histórico de runs (só modo exec)     │             │
 *  └──────────────────┴───────────────────────────────────────┴─────────────┘
 *
 * Indicadores:
 *  - Ponto pulsante azul  : a executar agora
 *  - Badge verde          : última execução com sucesso
 *  - Badge vermelho       : última execução com erro
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ListTodo,
  Loader2,
  Mail,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Trash2,
  Wand2,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { ChatLlmRoutingSelect } from "@/components/chat/ChatLlmRoutingSelect";
import { fetchLlmProfiles, type LlmProfileDTO } from "@/lib/llmProfilesApi";
import { parseLlmRoutingSelect } from "@/lib/llmRouting";
import * as contactsApi from "@/lib/contactsApi";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
  cronToHuman,
  type ScheduledTaskDTO,
  type CreateScheduledTaskInput,
  type TaskType,
} from "@/lib/scheduleApi";
import { fetchTaskLists, type TaskListDTO } from "@/lib/taskListsApi";
import * as wf from "@/lib/workflowsApi";
import type {
  WorkflowDTO,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowRunDTO,
} from "@/lib/workflowsApi";
import { AutomacaoLinearFlow } from "./AutomacaoLinearFlow";
import { AutomacaoWorkflowFlow } from "./AutomacaoWorkflowFlow";
import { AutomacaoRunHistory } from "./AutomacaoRunHistory";

// ── Constantes do editor de workflows ────────────────────────────────────────

const WF_TYPES = [
  "schedule",
  "goto",
  "click",
  "fill",
  "wait",
  "llm",
  "web_search",
  "send_email",
] as const;

const TZ_PRESETS = [
  "UTC",
  "America/Sao_Paulo",
  "Europe/Lisbon",
  "Europe/Madrid",
  "America/New_York",
] as const;

const KNOWN_WF_TYPES = new Set<string>(WF_TYPES);

type WfType = (typeof WF_TYPES)[number];

const WF_NODE_CATALOG: Record<
  WfType,
  { labelPt: string; descricaoCurta: string }
> = {
  schedule: {
    labelPt: "Agendamento",
    descricaoCurta: "Cron e fuso para executar o fluxo",
  },
  goto: { labelPt: "Ir para URL", descricaoCurta: "Abre uma página" },
  click: { labelPt: "Clicar", descricaoCurta: "Clique num elemento" },
  fill: { labelPt: "Preencher", descricaoCurta: "Preenche um campo" },
  wait: { labelPt: "Esperar", descricaoCurta: "Espera por um elemento" },
  llm: { labelPt: "LLM", descricaoCurta: "Gera texto com o modelo" },
  web_search: {
    labelPt: "Pesquisa web",
    descricaoCurta: "SerpApi (DuckDuckGo ou Google)",
  },
  send_email: {
    labelPt: "Enviar e-mail",
    descricaoCurta: "Envio SMTP no servidor",
  },
};

function defaultDataForWfType(t: WfType): Record<string, unknown> {
  const meta = WF_NODE_CATALOG[t];
  switch (t) {
    case "schedule":
      return {
        label: meta.labelPt,
        cron: "0 9 * * *",
        timezone: "America/Sao_Paulo",
        schedule_enabled: true,
      };
    case "goto":
      return { label: meta.labelPt, url: "https://example.com" };
    case "click":
    case "wait":
      return { label: meta.labelPt, selector: "" };
    case "fill":
      return { label: meta.labelPt, selector: "", value: "" };
    case "llm":
      return { label: meta.labelPt, prompt: "" };
    case "web_search":
      return {
        label: meta.labelPt,
        query: "",
        search_engine: "duckduckgo",
      };
    case "send_email":
      return {
        label: meta.labelPt,
        email_to: "",
        email_subject: "Assunto",
        email_body: "Corpo do e-mail",
      };
    default:
      return { label: meta.labelPt };
  }
}

const WfGraphActionsContext = createContext<{
  addConnectedNode: (fromId: string, t: WfType) => void;
} | null>(null);

// ── Utilitários do editor ─────────────────────────────────────────────────────

function normalizeWfNodeType(t: string): string {
  return KNOWN_WF_TYPES.has(t) ? t : "goto";
}

function graphToFlow(g: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (g.nodes ?? []).map((n) => ({
    id: n.id,
    type: normalizeWfNodeType(n.type),
    position: n.position ?? { x: 0, y: 0 },
    data: { ...n.data, label: n.data.label ?? n.type },
  }));
  const edges: Edge[] = (g.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return { nodes, edges };
}

function flowToGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  const gn: WorkflowNode[] = nodes.map((n) => ({
    id: n.id,
    type: String(n.type ?? "goto"),
    position: n.position,
    data: {
      url: (n.data as { url?: string }).url,
      selector: (n.data as { selector?: string }).selector,
      value: (n.data as { value?: string }).value,
      prompt: (n.data as { prompt?: string }).prompt,
      query: (n.data as { query?: string }).query,
      kl: (n.data as { kl?: string }).kl,
      df: (n.data as { df?: string }).df,
      safe: (n.data as { safe?: number }).safe,
      start: (n.data as { start?: number }).start,
      m: (n.data as { m?: number }).m,
      search_engine: (n.data as { search_engine?: string }).search_engine,
      timeout_ms: (n.data as { timeout_ms?: number }).timeout_ms,
      label: (n.data as { label?: string }).label,
      cron: (n.data as { cron?: string }).cron,
      timezone: (n.data as { timezone?: string }).timezone,
      schedule_enabled: (n.data as { schedule_enabled?: boolean }).schedule_enabled,
      email_to: (n.data as { email_to?: string }).email_to,
      contact_id: (n.data as { contact_id?: string }).contact_id,
      email_subject: (n.data as { email_subject?: string }).email_subject,
      email_body: (n.data as { email_body?: string }).email_body,
    },
  }));
  const ge: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return { nodes: gn, edges: ge };
}

// ── Nó editável (editor de workflows) ─────────────────────────────────────────

function WfEditNode(props: NodeProps) {
  const wfGraphActions = useContext(WfGraphActionsContext);
  const data = props.data as Record<string, unknown>;
  const label = (data?.label as string) || String(props.type ?? "nó");
  const t = String(props.type ?? "") as WfType;
  const typePt = WF_NODE_CATALOG[t]?.labelPt ?? String(props.type ?? "—");
  const isSchedule = String(props.type) === "schedule";
  const isSendEmail = String(props.type) === "send_email";
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !border-border !bg-muted !opacity-100"
      />
      <div
        className={cn(
          "relative min-w-[160px] rounded-md border bg-card px-2 pb-5 pt-1.5 text-xs shadow-sm",
          isSchedule
            ? "border-violet-500/60 ring-1 ring-violet-500/25"
            : isSendEmail
              ? "border-amber-500/60 ring-1 ring-amber-500/25"
              : "border-border",
        )}
      >
        <div className="flex items-center gap-1 font-medium text-foreground">
          {isSchedule ? (
            <Clock className="size-3 shrink-0 text-violet-600 dark:text-violet-400" />
          ) : isSendEmail ? (
            <Mail className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          ) : null}
          <span className="truncate">{label}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">{typePt}</div>
        {wfGraphActions ? (
          <div className="absolute -bottom-2.5 left-1/2 z-10 -translate-x-1/2">
            <DropdownMenu>
              <DropdownMenuTrigger
                nativeButton
                render={
                  <button
                    type="button"
                    title="Adicionar nó ligado"
                    className="flex size-6 items-center justify-center rounded-full border border-border bg-secondary text-foreground shadow-sm hover:bg-secondary/80"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Plus className="size-3" />
                  </button>
                }
              />
              <DropdownMenuContent
                align="center"
                className="max-h-64 overflow-y-auto"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {WF_TYPES.map((nodeT) => (
                  <DropdownMenuItem
                    key={nodeT}
                    onClick={() => wfGraphActions.addConnectedNode(props.id, nodeT)}
                  >
                    <span className="text-xs">{WF_NODE_CATALOG[nodeT].labelPt}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border !border-border !bg-muted !opacity-100"
      />
    </>
  );
}

const wfEditNodeTypes = {
  default: WfEditNode,
  schedule: WfEditNode,
  goto: WfEditNode,
  click: WfEditNode,
  fill: WfEditNode,
  wait: WfEditNode,
  llm: WfEditNode,
  web_search: WfEditNode,
  send_email: WfEditNode,
};

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: "task"; id: string }
  | { kind: "workflow"; id: string }
  | null;

type WfMode = "exec" | "edit";

type FormState = {
  name: string;
  description: string;
  task_type: TaskType;
  cron_expr: string;
  timezone: string;
  active: boolean;
  prompt: string;
  send_email: boolean;
  email_subject: string;
  include_tasks: boolean;
  include_finance: boolean;
  task_list_id: string;
  task_list_name: string;
};

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  task_type: "agent_prompt",
  cron_expr: "0 20 * * *",
  timezone: "America/Sao_Paulo",
  active: true,
  prompt: "",
  send_email: false,
  email_subject: "",
  include_tasks: true,
  include_finance: false,
  task_list_id: "",
  task_list_name: "",
};

const CRON_PRESETS = [
  { label: "Todo dia às 8h",      value: "0 8 * * *" },
  { label: "Todo dia às 12h",     value: "0 12 * * *" },
  { label: "Todo dia às 20h",     value: "0 20 * * *" },
  { label: "Toda segunda às 9h",  value: "0 9 * * 1" },
  { label: "Dias úteis às 8h",    value: "0 8 * * 1-5" },
  { label: "A cada hora",         value: "0 * * * *" },
  { label: "1º do mês às 9h",     value: "0 9 1 * *" },
];

// ── Helpers de form ────────────────────────────────────────────────────────────

function taskToForm(t: ScheduledTaskDTO): FormState {
  const p = (t.payload || {}) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description ?? "",
    task_type: t.task_type,
    cron_expr: t.cron_expr,
    timezone: t.timezone,
    active: t.active,
    prompt: String(p.prompt ?? ""),
    send_email: Boolean(p.send_email),
    email_subject: String(p.email_subject ?? ""),
    include_tasks: p.include_tasks !== false,
    include_finance: Boolean(p.include_finance),
    task_list_id: String(p.task_list_id ?? ""),
    task_list_name: String(p.task_list_name ?? ""),
  };
}

function formToInput(f: FormState): CreateScheduledTaskInput {
  const payload: Record<string, unknown> =
    f.task_type === "agent_prompt"
      ? {
          prompt: f.prompt.trim(),
          send_email: f.send_email,
          email_subject: f.email_subject.trim(),
          include_tasks: f.include_tasks,
          include_finance: f.include_finance,
        }
      : {
          task_list_id: f.task_list_id,
          task_list_name: f.task_list_name,
        };
  return {
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    task_type: f.task_type,
    cron_expr: f.cron_expr.trim(),
    timezone: f.timezone.trim() || "America/Sao_Paulo",
    active: f.active,
    payload,
  };
}

// ── Toggle interno ─────────────────────────────────────────────────────────────

function Toggle({ id, checked, onChange, label }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="cursor-pointer text-xs">{label}</label>
      <button
        id={id} type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? "bg-primary" : "bg-input"}`}
      >
        <span className={`pointer-events-none inline-block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

// ── Badge de estado da última execução ────────────────────────────────────────

function LastRunBadge({ lastRunAt, lastError, active }: {
  lastRunAt?: string | null; lastError?: string | null; active: boolean;
}) {
  if (!lastRunAt) {
    return (
      <span className="text-[10px] text-muted-foreground/60">
        {active ? "nunca executado" : "inactivo"}
      </span>
    );
  }
  if (lastError) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
        <AlertCircle className="size-3" />
        erro
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3" />
      ok
    </span>
  );
}

// ── Item da lista (tarefa agendada) ───────────────────────────────────────────

function TaskListItem({
  task, isSelected, isRunning, onSelect, onDelete,
}: {
  task: ScheduledTaskDTO;
  isSelected: boolean;
  isRunning: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const isPrompt = task.task_type === "agent_prompt";
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex flex-1 items-center gap-2.5 text-left"
      >
      <div className="relative shrink-0">
        <div className={cn(
          "flex size-7 items-center justify-center rounded-md",
          isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
        )}>
          {isPrompt ? <Bot className="size-3.5" /> : <ListTodo className="size-3.5" />}
        </div>
        {isRunning ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-2.5 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
        ) : task.last_error ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500" />
        ) : task.last_run_at ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium leading-tight">{task.name}</p>
        <p className="truncate text-[10px] text-muted-foreground/70">{cronToHuman(task.cron_expr)}</p>
      </div>
      <div className="shrink-0">
        {!task.active ? (
          <span className="text-[9px] text-muted-foreground/50">pausado</span>
        ) : (
          <LastRunBadge lastRunAt={task.last_run_at} lastError={task.last_error} active={task.active} />
        )}
      </div>
      </button>

      <Button
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        title="Apagar"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ── Item da lista (workflow) ───────────────────────────────────────────────────

function WorkflowListItem({
  workflow, isSelected, isRunning, lastRun, onSelect, onDelete,
}: {
  workflow: WorkflowDTO;
  isSelected: boolean;
  isRunning: boolean;
  lastRun?: WorkflowRunDTO | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const hasError = lastRun?.status === "error";
  const hasSuccess = lastRun?.status === "success";
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex flex-1 items-center gap-2.5 text-left"
      >
      <div className="relative shrink-0">
        <div className={cn(
          "flex size-7 items-center justify-center rounded-md",
          isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
        )}>
          <Workflow className="size-3.5" />
        </div>
        {isRunning ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-2.5 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
          </span>
        ) : hasError ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500" />
        ) : hasSuccess ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium leading-tight">{workflow.title}</p>
        {workflow.schedule_cron ? (
          <p className="truncate text-[10px] text-muted-foreground/70">{cronToHuman(workflow.schedule_cron)}</p>
        ) : (
          <p className="text-[10px] text-muted-foreground/50">sem agendamento</p>
        )}
      </div>
      <div className="shrink-0">
        {hasError ? (
          <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
            <AlertCircle className="size-3" />erro
          </span>
        ) : hasSuccess ? (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3" />ok
          </span>
        ) : workflow.schedule_cron && !workflow.schedule_enabled ? (
          <span className="text-[10px] text-amber-700/90 dark:text-amber-400/90">ag. pausado</span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">
            {workflow.schedule_enabled ? "activo" : "inactivo"}
          </span>
        )}
      </div>
      </button>

      <Button
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        title="Apagar"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ── Cabeçalho do item seleccionado ────────────────────────────────────────────

function DetailHeader({
  kind, task, workflow, running, wfMode,
  onRunNow, onEdit, onToggleActive, onDelete, onExitEdit,
  onToggleWorkflowSchedule, workflowScheduleToggleBusy,
}: {
  kind: "task" | "workflow";
  task?: ScheduledTaskDTO;
  workflow?: WorkflowDTO;
  running: boolean;
  wfMode?: WfMode;
  onRunNow: () => void;
  onEdit: () => void;
  onToggleActive?: () => void;
  onDelete: () => void;
  onExitEdit?: () => void;
  /** Só workflows em modo execução: pausa/retoma o nó schedule no grafo. */
  onToggleWorkflowSchedule?: () => void;
  workflowScheduleToggleBusy?: boolean;
}) {
  const name = kind === "task" ? task?.name : workflow?.title;
  const cron = kind === "task" ? task?.cron_expr : workflow?.schedule_cron;
  const tz = kind === "task" ? task?.timezone : workflow?.schedule_timezone;
  const isActive = kind === "task" ? task?.active : workflow?.schedule_enabled;

  return (
    <div className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border bg-card/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{name}</h2>
          <Badge variant={kind === "task" ? "outline" : "secondary"} className="text-[10px]">
            {kind === "task" ? (task?.task_type === "agent_prompt" ? "agente" : "lista") : "workflow"}
          </Badge>
          {wfMode === "edit" && (
            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
              modo editor
            </Badge>
          )}
          {isActive ? (
            <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
              activo
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">inactivo</Badge>
          )}
        </div>
        {cron ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{cron}</span>
            <span className="mx-1.5 opacity-50">·</span>
            {cronToHuman(cron)}
            {tz ? <span className="ml-1.5 opacity-50">{tz}</span> : null}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {wfMode === "edit" ? (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onExitEdit}>
            <ChevronDown className="size-3 rotate-90" />
            Execução
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant={running ? "secondary" : "default"}
              className="h-7 gap-1.5 text-[11px]"
              onClick={onRunNow}
              disabled={running}
            >
              {running ? (
                <><Loader2 className="size-3 animate-spin" />A executar…</>
              ) : (
                <><Play className="size-3" />Executar agora</>
              )}
            </Button>
            {kind === "workflow" &&
            cron &&
            String(cron).trim() !== "" &&
            onToggleWorkflowSchedule ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={onToggleWorkflowSchedule}
                disabled={Boolean(workflowScheduleToggleBusy) || running}
              >
                {workflowScheduleToggleBusy ? (
                  <><Loader2 className="size-3 animate-spin" />A actualizar…</>
                ) : workflow?.schedule_enabled ? (
                  <><PowerOff className="size-3" />Pausar agendamento</>
                ) : (
                  <><Power className="size-3" />Retomar agendamento</>
                )}
              </Button>
            ) : null}
            {kind === "workflow" ? (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onEdit}>
                <Pencil className="size-3" />
                Editar
              </Button>
            ) : (
              <>
                {onToggleActive ? (
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onToggleActive}>
                    {isActive ? <><PowerOff className="size-3" />Pausar</> : <><Power className="size-3" />Activar</>}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onEdit}>
                  <Pencil className="size-3" />
                  Editar
                </Button>
              </>
            )}
          </>
        )}
        <Button
          size="icon" variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete} title="Apagar"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Painel inspector do editor de workflows ───────────────────────────────────

function wfEmailBodyEnsurePrevious(body: string): string {
  if (/\{\{\s*previous\s*\}\}/i.test(body)) return body;
  const marker = "{{previous}}";
  const t = body.trimEnd();
  return t ? `${t}\n\n${marker}` : marker;
}

function wfEmailSubjectEnsurePrevious(subject: string): string {
  if (/\{\{\s*previous\s*\}\}/i.test(subject)) return subject;
  const marker = "{{previous}}";
  const t = subject.trimEnd();
  return t ? `${t} ${marker}` : marker;
}

function wfEmailAppendOutputToken(body: string, nodeId: string): string {
  const token = `{{output:${nodeId}}}`;
  if (body.includes(token)) return body;
  const t = body.trimEnd();
  return t ? `${t}\n\n${token}` : token;
}

interface WfInspectorPanelProps {
  wfTitle: string;
  setWfTitle: (v: string) => void;
  wfEditorId: string | null;
  wfSaving: boolean;
  wfRunBusy: boolean;
  wfError: string | null;
  genPrompt: string;
  setGenPrompt: (v: string) => void;
  recording: string;
  setRecording: (v: string) => void;
  llmSelectValue: string;
  setLlmSelectValue: (v: string) => void;
  llmProfiles: LlmProfileDTO[];
  genBusy: boolean;
  contactOptions: contactsApi.ContactDTO[];
  /** Nós actuais do grafo (picker de {{output:id}}). */
  wfGraphNodes: Node[];
  selectedNode: Node | null;
  onSave: () => void;
  onRun: () => void;
  onGenerate: () => void;
  onDeleteNode: () => void;
  onUpdateNodeData: (patch: Record<string, unknown>) => void;
  onSetNodeType: (type: string) => void;
  onClose: () => void;
}

function WfInspectorPanel({
  wfTitle, setWfTitle, wfEditorId, wfSaving, wfRunBusy, wfError,
  genPrompt, setGenPrompt, recording, setRecording,
  llmSelectValue, setLlmSelectValue, llmProfiles, genBusy,
  contactOptions, wfGraphNodes, selectedNode,
  onSave, onRun, onGenerate, onDeleteNode, onUpdateNodeData, onSetNodeType, onClose,
}: WfInspectorPanelProps) {
  const nodeType = selectedNode ? String(selectedNode.type ?? "") : "";
  const nd = selectedNode?.data as Record<string, unknown> | undefined;
  const [emailOutputPickerV, setEmailOutputPickerV] = useState(0);
  useEffect(() => {
    setEmailOutputPickerV((v) => v + 1);
  }, [selectedNode?.id]);

  return (
    <div className="nokey relative z-20 flex h-full w-[min(100%,320px)] shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
      {/* Cabeçalho */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">Editor de workflow</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} title="Fechar editor">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Conteúdo */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-3">

          {/* Título */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase text-muted-foreground">Título</label>
            <Input
              value={wfTitle}
              onChange={(e) => setWfTitle(e.target.value)}
              className="h-8 text-sm"
              placeholder="Nome do workflow"
            />
          </div>

          {/* Guardar / Executar */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 gap-1" onClick={onSave} disabled={wfSaving}>
              {wfSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {wfSaving ? "A guardar…" : "Guardar"}
            </Button>
            <Button
              size="sm" variant="secondary" className="flex-1 gap-1"
              disabled={!wfEditorId || wfRunBusy} onClick={onRun}
            >
              {wfRunBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Executar
            </Button>
          </div>

          {/* Inspector do nó seleccionado */}
          {selectedNode ? (
            <div className="space-y-2 rounded-md border border-border bg-background/80 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Nó seleccionado</span>
                <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={onDeleteNode}>
                  <Trash2 className="size-4" />
                </Button>
              </div>

              {/* Tipo do nó */}
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={nodeType}
                onChange={(e) => onSetNodeType(e.target.value)}
              >
                {WF_TYPES.map((t) => (
                  <option key={t} value={t}>{WF_NODE_CATALOG[t].labelPt}</option>
                ))}
              </select>

              {/* Etiqueta */}
              <Input
                placeholder="Etiqueta"
                className="h-8 text-xs"
                value={String(nd?.label ?? "")}
                onChange={(e) => onUpdateNodeData({ label: e.target.value })}
              />

              {/* URL (goto) */}
              {nodeType === "goto" ? (
                <Input
                  placeholder="URL"
                  className="h-8 text-xs"
                  value={String(nd?.url ?? "")}
                  onChange={(e) => onUpdateNodeData({ url: e.target.value })}
                />
              ) : null}

              {/* Selector CSS (click/fill/wait) */}
              {["click", "fill", "wait"].includes(nodeType) ? (
                <Input
                  placeholder="Selector CSS"
                  className="h-8 text-xs"
                  value={String(nd?.selector ?? "")}
                  onChange={(e) => onUpdateNodeData({ selector: e.target.value })}
                />
              ) : null}

              {/* Texto (fill) */}
              {nodeType === "fill" ? (
                <Input
                  placeholder="Texto a preencher"
                  className="h-8 text-xs"
                  value={String(nd?.value ?? "")}
                  onChange={(e) => onUpdateNodeData({ value: e.target.value })}
                />
              ) : null}

              {/* Prompt (llm) */}
              {nodeType === "llm" ? (
                <Textarea
                  placeholder="Mini-prompt"
                  className="min-h-[72px] text-xs"
                  value={String(nd?.prompt ?? "")}
                  onChange={(e) => onUpdateNodeData({ prompt: e.target.value })}
                />
              ) : null}

              {/* web_search */}
              {nodeType === "web_search" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Pesquisa na web via SerpApi (DuckDuckGo ou Google) com a mesma chave do servidor.
                    O resultado aparece no histórico do run.
                  </p>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Motor de pesquisa</label>
                    <Select
                      value={String((nd as { search_engine?: string })?.search_engine ?? "duckduckgo")}
                      onValueChange={(v) => onUpdateNodeData({ search_engine: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="duckduckgo">DuckDuckGo (SerpApi)</SelectItem>
                        <SelectItem value="google">Google (SerpApi)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    placeholder="Query (o que pesquisar)"
                    className="h-8 text-xs"
                    value={String((nd as { query?: string })?.query ?? "")}
                    onChange={(e) => onUpdateNodeData({ query: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Região (kl) ex.: br-pt, us-en"
                      className="h-8 text-xs"
                      value={String((nd as { kl?: string })?.kl ?? "")}
                      onChange={(e) => onUpdateNodeData({ kl: e.target.value })}
                    />
                    <Input
                      placeholder="Data (df) d/w/m/y ou YYYY-MM-DD..YYYY-MM-DD"
                      className="h-8 text-xs"
                      value={String((nd as { df?: string })?.df ?? "")}
                      onChange={(e) => onUpdateNodeData({ df: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}

              {/* send_email */}
              {nodeType === "send_email" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Envia e-mail pela conta SMTP configurada em Definições.
                  </p>
                  <p className="text-[9px] leading-snug text-muted-foreground/80">
                    No assunto ou corpo pode usar{" "}
                    <code className="rounded bg-muted px-0.5">{"{{previous}}"}</code> para inserir a saída dos nós
                    ligados a este (ex.: texto gerado pelo nó LLM a montante) ou{" "}
                    <code className="rounded bg-muted px-0.5">{"{{output:ID_DO_NÓ}}"}</code> para um nó específico.
                  </p>

                  <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-[10px] font-medium text-muted-foreground">Inserir sem decorar marcadores</p>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[10px]"
                        onClick={() =>
                          onUpdateNodeData({
                            email_body: wfEmailBodyEnsurePrevious(String(nd?.email_body ?? "")),
                          })
                        }
                      >
                        Corpo: nós anteriores
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[10px]"
                        onClick={() =>
                          onUpdateNodeData({
                            email_subject: wfEmailSubjectEnsurePrevious(String(nd?.email_subject ?? "")),
                          })
                        }
                      >
                        Assunto: nós anteriores
                      </Button>
                    </div>
                    {wfGraphNodes.some((n) => n.type === "llm" || n.type === "web_search") ? (
                      <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground">Inserir saída de um nó no corpo</label>
                        <select
                          key={`email-out-${selectedNode?.id ?? "x"}-${emailOutputPickerV}`}
                          className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                          defaultValue=""
                          onChange={(e) => {
                            const nodeId = e.target.value;
                            if (!nodeId) return;
                            onUpdateNodeData({
                              email_body: wfEmailAppendOutputToken(String(nd?.email_body ?? ""), nodeId),
                            });
                            setEmailOutputPickerV((v) => v + 1);
                          }}
                        >
                          <option value="">— Escolher nó —</option>
                          {wfGraphNodes
                            .filter((n) => n.type === "llm" || n.type === "web_search")
                            .map((n) => {
                              const d = n.data as Record<string, unknown>;
                              const lb = String(d?.label ?? n.id);
                              return (
                                <option key={n.id} value={n.id}>
                                  {lb} ({n.id})
                                </option>
                              );
                            })}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  <label className="text-[10px] font-medium text-muted-foreground">
                    E-mail(s) do destinatário
                  </label>
                  <Input
                    placeholder="email@exemplo.com, outro@exemplo.com"
                    className="h-8 text-xs"
                    value={String(nd?.email_to ?? "")}
                    onChange={(e) => onUpdateNodeData({ email_to: e.target.value })}
                  />
                  <p className="text-[9px] text-muted-foreground/70">
                    Separe múltiplos endereços com vírgula. Tem prioridade sobre a agenda abaixo.
                  </p>

                  {contactOptions.length > 0 ? (
                    <>
                      <label className="text-[10px] text-muted-foreground">Ou escolher da agenda</label>
                      <select
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={String(nd?.contact_id ?? "")}
                        onChange={(e) => onUpdateNodeData({ contact_id: e.target.value })}
                      >
                        <option value="">— seleccionar —</option>
                        {contactOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                        ))}
                      </select>
                    </>
                  ) : null}

                  <Input
                    placeholder="Assunto"
                    className="h-8 text-xs"
                    value={String(nd?.email_subject ?? "")}
                    onChange={(e) => onUpdateNodeData({ email_subject: e.target.value })}
                  />
                  <Textarea
                    placeholder="Corpo do e-mail"
                    className="min-h-[80px] text-xs"
                    value={String(nd?.email_body ?? "")}
                    onChange={(e) => onUpdateNodeData({ email_body: e.target.value })}
                  />
                </div>
              ) : null}

              {/* schedule */}
              {nodeType === "schedule" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    O servidor executa este workflow no horário definido (cron 5 campos).
                  </p>
                  <Input
                    placeholder="Cron — ex. 0 9 * * *"
                    className="h-8 font-mono text-[11px]"
                    value={String(nd?.cron ?? "")}
                    onChange={(e) => onUpdateNodeData({ cron: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: "Diário 9h", cron: "0 9 * * *" },
                      { label: "Cada hora", cron: "0 * * * *" },
                      { label: "15 min", cron: "*/15 * * * *" },
                    ].map((p) => (
                      <Button
                        key={p.cron} type="button" size="sm" variant="outline"
                        className="h-7 text-[10px]"
                        onClick={() => onUpdateNodeData({ cron: p.cron, schedule_enabled: true })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  <label className="text-[10px] text-muted-foreground">Fuso horário (IANA)</label>
                  <select
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={String(nd?.timezone ?? "Europe/Lisbon")}
                    onChange={(e) => onUpdateNodeData({ timezone: e.target.value })}
                  >
                    {TZ_PRESETS.map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border-input"
                      checked={Boolean(nd?.schedule_enabled)}
                      onChange={(e) => onUpdateNodeData({ schedule_enabled: e.target.checked })}
                    />
                    Agendamento activo
                  </label>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Clique num nó para editar as suas propriedades.</p>
          )}

          {/* Geração por LLM */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[10px] font-medium uppercase text-muted-foreground">Gerar com LLM</p>
            <ChatLlmRoutingSelect
              value={llmSelectValue}
              onValueChange={setLlmSelectValue}
              profiles={llmProfiles}
              className="w-full max-w-none"
            />
            <Textarea
              placeholder="Descreve a automação (ex.: abrir site X, clicar em login e enviar email)…"
              className="min-h-[72px] text-xs"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
            />
            <Textarea
              placeholder="Gravação / trace JSON (opcional)"
              className="min-h-[48px] text-[10px] text-muted-foreground"
              value={recording}
              onChange={(e) => setRecording(e.target.value)}
            />
            <Button
              size="sm" className="w-full gap-1"
              disabled={genBusy || !genPrompt.trim()}
              onClick={onGenerate}
            >
              {genBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              Gerar grafo
            </Button>
          </div>

          {/* Erro */}
          {wfError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {wfError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Formulário (criar / editar tarefa) ────────────────────────────────────────

function TaskFormPanel({
  form, setForm, taskLists, editingId, saving, error, onSave, onCancel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  taskLists: TaskListDTO[];
  editingId: string | null;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">
          {editingId ? "Editar automação" : "Nova automação agendada"}
        </h3>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCancel}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-xs font-medium">Nome *</label>
          <Input
            value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="Ex: Resumo diário às 20h" className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Tipo</label>
          <Select value={form.task_type} onValueChange={(v) => set("task_type", v as TaskType)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agent_prompt">Prompt ao agente</SelectItem>
              <SelectItem value="run_task_list">Executar lista de tarefas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.task_type === "agent_prompt" && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium">Prompt *</label>
              <Textarea
                value={form.prompt} onChange={(e) => set("prompt", e.target.value)}
                placeholder="Ex: Resume as minhas tarefas de hoje e envia por email."
                rows={3} className="text-sm resize-none"
              />
            </div>
            <Toggle id="send-email" checked={form.send_email} onChange={(v) => set("send_email", v)} label="Enviar resultado por email" />
            {form.send_email && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Assunto do email</label>
                <Input
                  value={form.email_subject} onChange={(e) => set("email_subject", e.target.value)}
                  placeholder="Ex: Resumo do dia — Open Polvo" className="h-8 text-sm"
                />
              </div>
            )}
            <Toggle id="inc-tasks" checked={form.include_tasks} onChange={(v) => set("include_tasks", v)} label="Incluir contexto de tarefas" />
            <Toggle id="inc-finance" checked={form.include_finance} onChange={(v) => set("include_finance", v)} label="Incluir contexto de finanças" />
          </>
        )}

        {form.task_type === "run_task_list" && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Lista de tarefas *</label>
            <Select
              value={form.task_list_id}
              onValueChange={(v) => {
                const id = v ?? "";
                const tl = taskLists.find((t) => t.id === id);
                set("task_list_id", id);
                if (tl) set("task_list_name", tl.title);
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Seleccionar lista…" />
              </SelectTrigger>
              <SelectContent>
                {taskLists.map((tl) => (
                  <SelectItem key={tl.id} value={tl.id}>{tl.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium">Expressão CRON *</label>
          <div className="flex gap-2">
            <Input
              value={form.cron_expr} onChange={(e) => set("cron_expr", e.target.value)}
              placeholder="0 20 * * *" className="h-8 text-sm font-mono flex-1"
            />
            <Select onValueChange={(v) => set("cron_expr", String(v ?? ""))}>
              <SelectTrigger className="h-8 text-sm w-36">
                <SelectValue placeholder="Preset…" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.cron_expr && (
            <p className="text-[10px] text-muted-foreground">↳ {cronToHuman(form.cron_expr)}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Fuso horário</label>
          <Input
            value={form.timezone} onChange={(e) => set("timezone", e.target.value)}
            placeholder="America/Sao_Paulo" className="h-8 text-sm"
          />
        </div>

        <Toggle id="task-active" checked={form.active} onChange={(v) => set("active", v)} label="Activar ao guardar" />
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
        <Button size="sm" className="flex-1" onClick={onSave} disabled={saving}>
          {saving ? <><Loader2 className="size-3 animate-spin" /> A guardar…</> : (editingId ? "Guardar" : "Criar automação")}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────

export function AutomacaoPage() {
  const { token } = useAuth();

  // ── Dados ─────────────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<ScheduledTaskDTO[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDTO[]>([]);
  const [taskLists, setTaskLists] = useState<TaskListDTO[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Selecção ─────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Selection>(null);

  // ── Execução ─────────────────────────────────────────────────────────────────
  const [runningId, setRunningId] = useState<string | null>(null);

  // ── Histórico de runs (workflows) ─────────────────────────────────────────────
  const [wfRuns, setWfRuns] = useState<WorkflowRunDTO[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // ── Formulário de tarefa (criar/editar) ───────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Painel de histórico ────────────────────────────────────────────────────────
  const [historyExpanded, setHistoryExpanded] = useState(true);

  // ── Editor de workflow ────────────────────────────────────────────────────────
  const [wfMode, setWfMode] = useState<WfMode>("exec");
  const [wfEditorId, setWfEditorId] = useState<string | null>(null);
  const [wfTitle, setWfTitle] = useState("Novo workflow");
  const [wfNodes, setWfNodes, onWfNodesChange] = useNodesState<Node>([]);
  const [wfEdges, setWfEdges, onWfEdgesChange] = useEdgesState<Edge>([]);
  const [wfSelNodeId, setWfSelNodeId] = useState<string | null>(null);
  const [wfSaving, setWfSaving] = useState(false);
  const [wfRunBusy, setWfRunBusy] = useState(false);
  const [wfScheduleToggleBusy, setWfScheduleToggleBusy] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const [recording, setRecording] = useState("");
  const [llmSelectValue, setLlmSelectValue] = useState("auto");
  const [llmProfiles, setLlmProfiles] = useState<LlmProfileDTO[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [contactOptions, setContactOptions] = useState<contactsApi.ContactDTO[]>([]);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Carregar dados auxiliares do editor ───────────────────────────────────────

  useEffect(() => {
    if (!token) return;
    void contactsApi.listContacts(token).then(setContactOptions).catch(() => setContactOptions([]));
    void fetchLlmProfiles(token).then(setLlmProfiles).catch(() => setLlmProfiles([]));
  }, [token]);

  // ── Carregar lista principal ──────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoadingAll(true);
    setGlobalError(null);
    try {
      const [ts, wfs, tls] = await Promise.all([
        listScheduledTasks(token),
        wf.fetchWorkflows(token),
        fetchTaskLists(token),
      ]);
      if (!mountedRef.current) return;
      setTasks(ts);
      setWorkflows(wfs);
      setTaskLists(tls);
    } catch (e) {
      if (mountedRef.current) setGlobalError(String(e));
    } finally {
      if (mountedRef.current) setLoadingAll(false);
    }
  }, [token]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Carregar runs quando workflow seleccionado (em modo exec)
  useEffect(() => {
    if (!token || !selected || selected.kind !== "workflow") {
      setWfRuns([]);
      return;
    }
    const id = selected.id;
    setLoadingRuns(true);
    wf.fetchWorkflowRuns(token, id)
      .then((runs) => { if (mountedRef.current) setWfRuns(runs); })
      .catch(() => { if (mountedRef.current) setWfRuns([]); })
      .finally(() => { if (mountedRef.current) setLoadingRuns(false); });
  }, [token, selected]);

  // ── Execução ─────────────────────────────────────────────────────────────────

  const handleRunNow = useCallback(async () => {
    if (!token || !selected || runningId) return;
    const id = selected.id;
    setRunningId(id);
    try {
      if (selected.kind === "task") {
        await runScheduledTaskNow(token, id);
        const updated = await listScheduledTasks(token);
        if (mountedRef.current) setTasks(updated);
      } else {
        const run = await wf.runWorkflow(token, id);
        if (mountedRef.current) setWfRuns((prev) => [run, ...prev.slice(0, 4)]);
      }
    } catch (e) {
      if (mountedRef.current) setGlobalError(String(e));
    } finally {
      if (mountedRef.current) setRunningId(null);
    }
  }, [token, selected, runningId]);

  // ── Toggle activo (tasks) ─────────────────────────────────────────────────────

  const handleToggleActive = useCallback(async () => {
    if (!token || !selected || selected.kind !== "task") return;
    const task = tasks.find((t) => t.id === selected.id);
    if (!task) return;
    try {
      await updateScheduledTask(token, selected.id, { active: !task.active });
      setTasks((prev) => prev.map((t) => t.id === selected.id ? { ...t, active: !task.active } : t));
    } catch (e) {
      setGlobalError(String(e));
    }
  }, [token, selected, tasks]);

  // ── Apagar ────────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!token || !selected) return;
    if (!confirm("Apagar esta automação?")) return;
    try {
      if (selected.kind === "task") {
        await deleteScheduledTask(token, selected.id);
        setTasks((prev) => prev.filter((t) => t.id !== selected.id));
      } else {
        await wf.deleteWorkflow(token, selected.id);
        setWorkflows((prev) => prev.filter((w) => w.id !== selected.id));
        setWfMode("exec");
      }
      setSelected(null);
    } catch (e) {
      setGlobalError(String(e));
    }
  }, [token, selected]);

  // ── Formulário de task ────────────────────────────────────────────────────────

  const openNew = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setFormError(null);
    setShowForm(true);
    setSelected(null);
    setWfMode("exec");
  };

  const openEdit = (task: ScheduledTaskDTO) => {
    setEditingId(task.id);
    setForm(taskToForm(task));
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!token) return;
    if (!form.name.trim() || !form.cron_expr.trim()) {
      setFormError("Nome e CRON são obrigatórios.");
      return;
    }
    if (form.task_type === "agent_prompt" && !form.prompt.trim()) {
      setFormError("O prompt é obrigatório.");
      return;
    }
    if (form.task_type === "run_task_list" && !form.task_list_id) {
      setFormError("Seleccione uma lista de tarefas.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input = formToInput(form);
      if (editingId) {
        const updated = await updateScheduledTask(token, editingId, input);
        setTasks((prev) => prev.map((t) => t.id === editingId ? updated : t));
      } else {
        const created = await createScheduledTask(token, input);
        setTasks((prev) => [created, ...prev]);
        setSelected({ kind: "task", id: created.id });
      }
      setShowForm(false);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── Editor de workflow ────────────────────────────────────────────────────────

  /** Rascunho de novo workflow (canvas vazio). */
  const newWfDraft = useCallback(() => {
    setWfEditorId(null);
    setWfTitle("Novo workflow");
    setWfNodes([
      {
        id: "n-sched",
        type: "schedule",
        position: { x: 80, y: 40 },
        data: { label: "Agendamento", cron: "0 9 * * *", timezone: "America/Sao_Paulo", schedule_enabled: true },
      },
      {
        id: "n1",
        type: "goto",
        position: { x: 80, y: 200 },
        data: { label: "Abrir URL", url: "https://exemplo.com" },
      },
    ]);
    setWfEdges([{ id: "e-sched-goto", source: "n-sched", target: "n1" }]);
    setWfSelNodeId(null);
    setWfError(null);
    setGenPrompt("");
    setRecording("");
    setWfMode("edit");
    setShowForm(false);
    setSelected(null);
  }, [setWfNodes, setWfEdges]);

  /** Carrega um workflow existente no editor. */
  const loadWfForEdit = useCallback(async (id: string) => {
    if (!token) return;
    setWfError(null);
    try {
      const w = await wf.getWorkflow(token, id);
      const { nodes: ns, edges: es } = graphToFlow(w.graph);
      setWfNodes(ns);
      setWfEdges(es);
      setWfTitle(w.title);
      setWfEditorId(id);
      setWfSelNodeId(null);
      setWfMode("edit");
      setShowForm(false);
    } catch (e) {
      setGlobalError(String(e));
    }
  }, [token, setWfNodes, setWfEdges]);

  /** Pausa ou retoma o agendamento (primeiro nó schedule no grafo). */
  const toggleWorkflowSchedule = useCallback(async () => {
    if (!token || !selected || selected.kind !== "workflow") return;
    const wid = selected.id;
    setWfScheduleToggleBusy(true);
    setGlobalError(null);
    try {
      const w = await wf.getWorkflow(token, wid);
      const graph: WorkflowGraph = {
        nodes: w.graph.nodes.map((n) => ({
          ...n,
          data: { ...n.data },
        })),
        edges: w.graph.edges.map((e) => ({ ...e })),
      };
      const idx = graph.nodes.findIndex((n) => n.type === "schedule");
      if (idx < 0) {
        setGlobalError("Este workflow não tem nó de agendamento.");
        return;
      }
      const node = graph.nodes[idx];
      const cur = Boolean(node.data.schedule_enabled ?? w.schedule_enabled);
      graph.nodes[idx] = {
        ...node,
        data: { ...node.data, schedule_enabled: !cur },
      };
      const updated = await wf.updateWorkflow(token, wid, { graph });
      setWorkflows((prev) => prev.map((x) => (x.id === wid ? updated : x)));
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
    } finally {
      setWfScheduleToggleBusy(false);
    }
  }, [token, selected]);

  /** Guarda o workflow (criar ou actualizar). */
  const saveWf = useCallback(async () => {
    if (!token) return;
    setWfSaving(true);
    setWfError(null);
    const graph = flowToGraph(wfNodes, wfEdges);
    try {
      if (wfEditorId) {
        const updated = await wf.updateWorkflow(token, wfEditorId, { title: wfTitle, graph });
        setWorkflows((prev) => prev.map((w) => w.id === wfEditorId ? updated : w));
      } else {
        const created = await wf.createWorkflow(token, { title: wfTitle, graph });
        setWorkflows((prev) => [created, ...prev]);
        setWfEditorId(created.id);
        setSelected({ kind: "workflow", id: created.id });
      }
    } catch (e) {
      setWfError(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setWfSaving(false);
    }
  }, [token, wfEditorId, wfTitle, wfNodes, wfEdges]);

  /** Executa o workflow a partir do editor. */
  const runWfFromEditor = useCallback(async () => {
    if (!token || !wfEditorId) {
      setWfError("Guarde o workflow antes de executar.");
      return;
    }
    setWfRunBusy(true);
    setWfError(null);
    try {
      const run = await wf.runWorkflow(token, wfEditorId);
      if (mountedRef.current) setWfRuns((prev) => [run, ...prev.slice(0, 4)]);
    } catch (e) {
      setWfError(e instanceof Error ? e.message : "Erro na execução");
    } finally {
      setWfRunBusy(false);
    }
  }, [token, wfEditorId]);

  /** Gera grafo via LLM. */
  const generateWf = useCallback(async () => {
    if (!token || !genPrompt.trim()) return;
    setGenBusy(true);
    setWfError(null);
    try {
      const { model, profileId } = parseLlmRoutingSelect(llmSelectValue);
      const res = await wf.generateWorkflow(token, {
        prompt: genPrompt,
        recording_json: recording.trim() || undefined,
        model_provider: model,
        llm_profile_id: profileId ?? undefined,
      });
      const { nodes: ns, edges: es } = graphToFlow(res.graph);
      setWfNodes(ns);
      setWfEdges(es);
      if (!wfTitle || wfTitle === "Novo workflow") setWfTitle("Workflow gerado");
    } catch (e) {
      setWfError(e instanceof Error ? e.message : "Erro na geração");
    } finally {
      setGenBusy(false);
    }
  }, [token, genPrompt, recording, llmSelectValue, wfTitle, setWfNodes, setWfEdges]);

  /** Adiciona nó ao grafo editor. */
  const addWfNode = useCallback((t: WfType) => {
    const id = `n-${Date.now()}`;
    const data = defaultDataForWfType(t);
    setWfNodes((ns) => [
      ...ns,
      { id, type: t, position: { x: 120 + ns.length * 40, y: 120 + ns.length * 20 }, data },
    ]);
    setWfSelNodeId(id);
  }, [setWfNodes]);

  /** Novo nó ligado por aresta a partir de um nó existente (botão + no nó). */
  const addConnectedWfNode = useCallback((fromId: string, t: WfType) => {
    const id = `n-${Date.now()}`;
    const data = defaultDataForWfType(t);
    setWfNodes((ns) => {
      const from = ns.find((n) => n.id === fromId);
      const pos = from
        ? { x: from.position.x, y: (from.position.y as number) + 140 }
        : { x: 120, y: 120 };
      return [...ns, { id, type: t, position: pos, data }];
    });
    setWfEdges((es) => [...es, { id: `e-${fromId}-${id}`, source: fromId, target: id }]);
    setWfSelNodeId(id);
  }, [setWfNodes, setWfEdges]);

  const wfGraphActionsValue = useMemo(
    () => ({ addConnectedNode: addConnectedWfNode }),
    [addConnectedWfNode],
  );

  /** Remove o nó seleccionado. */
  const deleteWfNode = useCallback(() => {
    if (!wfSelNodeId) return;
    setWfNodes((ns) => ns.filter((n) => n.id !== wfSelNodeId));
    setWfEdges((es) => es.filter((e) => e.source !== wfSelNodeId && e.target !== wfSelNodeId));
    setWfSelNodeId(null);
  }, [wfSelNodeId, setWfNodes, setWfEdges]);

  /** Actualiza dados do nó seleccionado. */
  const updateWfNodeData = useCallback((patch: Record<string, unknown>) => {
    if (!wfSelNodeId) return;
    setWfNodes((ns) => ns.map((n) => n.id === wfSelNodeId ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [wfSelNodeId, setWfNodes]);

  /** Muda o tipo do nó seleccionado. */
  const setWfNodeType = useCallback((type: string) => {
    if (!wfSelNodeId) return;
    setWfNodes((ns) => ns.map((n) => n.id === wfSelNodeId ? { ...n, type } : n));
  }, [wfSelNodeId, setWfNodes]);

  /** Conectar nós. */
  const onWfConnect = useCallback((c: Connection) => {
    setWfEdges((eds) => addEdge({ ...c, id: `e-${c.source}-${c.target}-${eds.length}` }, eds));
  }, [setWfEdges]);

  /** Nó seleccionado no editor. */
  const selectedWfNode = wfNodes.find((n) => n.id === wfSelNodeId) ?? null;

  // ── Dados derivados ───────────────────────────────────────────────────────────

  const selectedTask = selected?.kind === "task" ? tasks.find((t) => t.id === selected.id) ?? null : null;
  const selectedWorkflow = selected?.kind === "workflow" ? workflows.find((w) => w.id === selected.id) ?? null : null;
  const isRunning = runningId === selected?.id;
  const lastWfRun = wfRuns[0] ?? null;
  const scheduledWorkflows = workflows.filter((w) => w.schedule_cron && w.schedule_enabled);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────────── */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Zap className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Automação</h1>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{tasks.filter((t) => t.active).length + scheduledWorkflows.length} activas</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => void loadAll()} title="Actualizar">
            <RefreshCw className={cn("size-3.5", loadingAll && "animate-spin")} />
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={openNew}>
            <Plus className="size-3" />
            Nova agendada
          </Button>
          <Button size="sm" className="h-7 gap-1.5 text-[11px]" onClick={newWfDraft}>
            <Workflow className="size-3" />
            Novo workflow
          </Button>
        </div>
      </header>

      {globalError ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {globalError}
          <button onClick={() => setGlobalError(null)} className="ml-2 underline">fechar</button>
        </div>
      ) : null}

      {/* ── Corpo ─────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Sidebar esquerda ──────────────────────────────────────────────── */}
        <aside className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r border-border">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingAll ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Tarefas agendadas */}
                {tasks.length > 0 ? (
                  <div className="mb-3">
                    <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Agendadas ({tasks.length})
                    </p>
                    <div className="space-y-0.5">
                      {tasks.map((t) => (
                        <TaskListItem
                          key={t.id}
                          task={t}
                          isSelected={selected?.kind === "task" && selected.id === t.id}
                          isRunning={runningId === t.id}
                          onSelect={() => {
                            setSelected({ kind: "task", id: t.id });
                            setShowForm(false);
                            setWfMode("exec");
                          }}
                          onDelete={() => {
                            setSelected({ kind: "task", id: t.id });
                            void handleDelete();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Workflows */}
                {workflows.length > 0 ? (
                  <div className="mb-3">
                    <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Workflows ({workflows.length})
                    </p>
                    <div className="space-y-0.5">
                      {workflows.map((wfItem) => (
                        <WorkflowListItem
                          key={wfItem.id}
                          workflow={wfItem}
                          isSelected={selected?.kind === "workflow" && selected.id === wfItem.id}
                          isRunning={runningId === wfItem.id}
                          lastRun={selected?.kind === "workflow" && selected.id === wfItem.id ? lastWfRun : null}
                          onSelect={() => {
                            setSelected({ kind: "workflow", id: wfItem.id });
                            setShowForm(false);
                            setWfMode("exec");
                          }}
                          onDelete={() => {
                            setSelected({ kind: "workflow", id: wfItem.id });
                            void handleDelete();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {tasks.length === 0 && workflows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <Clock className="size-8 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">Sem automações</p>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={openNew}>
                      <Plus className="size-3 mr-1" />
                      Criar
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>

        {/* ── Área central ───────────────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

          {/* ── Modo editor de workflow ───────────────────────────────────────── */}
          {wfMode === "edit" ? (
            <>
              {/* Cabeçalho do editor (quando editando workflow existente) */}
              {selected?.kind === "workflow" && selectedWorkflow ? (
                <DetailHeader
                  kind="workflow"
                  workflow={selectedWorkflow}
                  running={false}
                  wfMode="edit"
                  onRunNow={() => void handleRunNow()}
                  onEdit={() => void loadWfForEdit(selectedWorkflow.id)}
                  onDelete={() => void handleDelete()}
                  onExitEdit={() => setWfMode("exec")}
                />
              ) : (
                /* Barra de novo workflow */
                <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card/40 px-4 py-2.5">
                  <Workflow className="size-4 text-primary" />
                  <span className="text-sm font-semibold">Novo workflow</span>
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                    modo editor
                  </Badge>
                  <Button
                    size="sm" variant="ghost"
                    className="ml-auto h-7 gap-1 text-[11px] text-muted-foreground"
                    onClick={() => { setWfMode("exec"); setSelected(null); }}
                  >
                    <X className="size-3" />
                    Cancelar
                  </Button>
                </div>
              )}

              {/* Canvas XYFlow editável */}
              <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
                <WfGraphActionsContext.Provider value={wfGraphActionsValue}>
                  <ReactFlow
                    nodes={wfNodes}
                    edges={wfEdges}
                    onNodesChange={onWfNodesChange}
                    onEdgesChange={onWfEdgesChange}
                    onConnect={onWfConnect}
                    nodeTypes={wfEditNodeTypes}
                    fitView
                    onNodeClick={(_, n) => setWfSelNodeId(n.id)}
                    onPaneClick={() => setWfSelNodeId(null)}
                    deleteKeyCode={null}
                    disableKeyboardA11y
                    nodesFocusable={false}
                    edgesFocusable={false}
                    className="h-full w-full bg-muted/10 [&_.react-flow__edge-path]:stroke-border [&_.react-flow__connectionline]:stroke-border"
                  >
                    <Background gap={16} size={1} className="opacity-40" />
                    <Controls className="overflow-hidden rounded-md border border-border bg-card shadow-md [&_button]:border-border [&_button]:bg-background [&_button]:text-foreground [&_button:hover]:bg-muted [&_button]:disabled:opacity-40" />
                    <MiniMap
                      className="!rounded-md !border !border-border !bg-card/95"
                      maskColor="rgba(0,0,0,0.45)"
                      nodeStrokeColor="var(--border)"
                      nodeColor={() => "var(--muted)"}
                    />
                    <Panel position="top-left" className="max-w-[min(100%,520px)] flex flex-wrap gap-1">
                      {WF_TYPES.map((t) => (
                        <Button
                          key={t} size="sm" variant="outline"
                          className="h-7 max-w-[140px] truncate text-[10px]"
                          title={WF_NODE_CATALOG[t].descricaoCurta}
                          onClick={() => addWfNode(t)}
                        >
                          + {WF_NODE_CATALOG[t].labelPt}
                        </Button>
                      ))}
                    </Panel>
                  </ReactFlow>
                </WfGraphActionsContext.Provider>
              </div>
            </>
          ) : /* ── Modo execução ─────────────────────────────────────────────── */
          !selected && !showForm ? (
            /* Estado vazio */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/40">
                <Zap className="size-8 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Seleccione uma automação</p>
                <p className="mt-1 text-xs text-muted-foreground/60 max-w-xs">
                  Clique numa automação para ver o grafo de execução e o histórico de runs.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={openNew} className="gap-1.5">
                  <Plus className="size-3" />
                  Nova agendada
                </Button>
                <Button size="sm" variant="outline" onClick={newWfDraft} className="gap-1.5">
                  <Workflow className="size-3" />
                  Novo workflow
                </Button>
              </div>
            </div>
          ) : selected && !showForm ? (
            <>
              {/* Cabeçalho do item seleccionado */}
              {selected.kind === "task" && selectedTask ? (
                <DetailHeader
                  kind="task"
                  task={selectedTask}
                  running={isRunning}
                  onRunNow={() => void handleRunNow()}
                  onEdit={() => openEdit(selectedTask)}
                  onToggleActive={() => void handleToggleActive()}
                  onDelete={() => void handleDelete()}
                />
              ) : selected.kind === "workflow" && selectedWorkflow ? (
                <DetailHeader
                  kind="workflow"
                  workflow={selectedWorkflow}
                  running={isRunning}
                  wfMode="exec"
                  onRunNow={() => void handleRunNow()}
                  onEdit={() => void loadWfForEdit(selectedWorkflow.id)}
                  onDelete={() => void handleDelete()}
                  onToggleWorkflowSchedule={() => void toggleWorkflowSchedule()}
                  workflowScheduleToggleBusy={wfScheduleToggleBusy}
                />
              ) : null}

              {/* Grafo visual + histórico */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Grafo */}
                <div
                  className="relative min-h-0 flex-1 overflow-hidden border-b border-border bg-muted/5"
                  style={{ minHeight: "180px" }}
                >
                  {selected.kind === "task" && selectedTask ? (
                    <AutomacaoLinearFlow task={selectedTask} running={isRunning} />
                  ) : selected.kind === "workflow" && selectedWorkflow ? (
                    <AutomacaoWorkflowFlow
                      workflow={selectedWorkflow}
                      lastRun={lastWfRun}
                      running={isRunning}
                    />
                  ) : null}

                  {isRunning ? (
                    <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-blue-500/10 py-1.5 text-[11px] text-blue-700 dark:text-blue-300 backdrop-blur-sm">
                      <Loader2 className="size-3 animate-spin" />
                      A executar — aguarde…
                    </div>
                  ) : null}
                </div>

                {/* Histórico (recolhível) */}
                <div
                  className={cn(
                    "shrink-0 overflow-hidden border-t border-border transition-all duration-300",
                    historyExpanded ? "flex-1 min-h-[160px] max-h-[45%]" : "h-9",
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
                    onClick={() => setHistoryExpanded((v) => !v)}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Histórico de execuções
                    </span>
                    {historyExpanded ? (
                      <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronUp className="ml-auto size-3.5 text-muted-foreground" />
                    )}
                  </button>
                  {historyExpanded ? (
                    <div className="h-[calc(100%-36px)] overflow-y-auto px-3 pb-3">
                      {selected.kind === "task" && selectedTask ? (
                        <AutomacaoRunHistory kind="task" task={selectedTask} running={isRunning} />
                      ) : selected.kind === "workflow" ? (
                        <AutomacaoRunHistory kind="workflow" wfRuns={wfRuns} running={isRunning} loadingRuns={loadingRuns} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* ── Painel direito ────────────────────────────────────────────────── */}
        {wfMode === "edit" ? (
          <WfInspectorPanel
            wfTitle={wfTitle}
            setWfTitle={setWfTitle}
            wfEditorId={wfEditorId}
            wfSaving={wfSaving}
            wfRunBusy={wfRunBusy}
            wfError={wfError}
            genPrompt={genPrompt}
            setGenPrompt={setGenPrompt}
            recording={recording}
            setRecording={setRecording}
            llmSelectValue={llmSelectValue}
            setLlmSelectValue={setLlmSelectValue}
            llmProfiles={llmProfiles}
            genBusy={genBusy}
            contactOptions={contactOptions}
            wfGraphNodes={wfNodes}
            selectedNode={selectedWfNode}
            onSave={() => void saveWf()}
            onRun={() => void runWfFromEditor()}
            onGenerate={() => void generateWf()}
            onDeleteNode={deleteWfNode}
            onUpdateNodeData={updateWfNodeData}
            onSetNodeType={setWfNodeType}
            onClose={() => setWfMode("exec")}
          />
        ) : showForm ? (
          <div className="w-[320px] shrink-0 overflow-hidden border-l border-border">
            <TaskFormPanel
              form={form}
              setForm={setForm}
              taskLists={taskLists}
              editingId={editingId}
              saving={saving}
              error={formError}
              onSave={() => void handleSave()}
              onCancel={() => setShowForm(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
