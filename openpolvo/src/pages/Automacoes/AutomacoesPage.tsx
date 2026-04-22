import { useEffect, useState, useCallback } from "react";
import {
  Clock,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  ChevronRight,
  Bot,
  ListTodo,
  RefreshCw,
  X,
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
import { useAuth } from "@/auth/AuthContext";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  cronToHuman,
  type ScheduledTaskDTO,
  type CreateScheduledTaskInput,
  type TaskType,
} from "@/lib/scheduleApi";
import { fetchTaskLists, type TaskListDTO } from "@/lib/taskListsApi";

// ─── form state ──────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  description: string;
  task_type: TaskType;
  cron_expr: string;
  timezone: string;
  active: boolean;
  // agent_prompt payload
  prompt: string;
  send_email: boolean;
  email_subject: string;
  include_tasks: boolean;
  include_finance: boolean;
  // run_task_list payload
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

// ─── CRON presets ─────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: "Todo dia às 8h", value: "0 8 * * *" },
  { label: "Todo dia às 12h", value: "0 12 * * *" },
  { label: "Todo dia às 20h", value: "0 20 * * *" },
  { label: "Toda segunda às 9h", value: "0 9 * * 1" },
  { label: "Dias úteis às 8h", value: "0 8 * * 1-5" },
  { label: "A cada hora", value: "0 * * * *" },
  { label: "1º de cada mês às 9h", value: "0 9 1 * *" },
];

// ─── inline toggle ─────────────────────────────────────────────────────────────

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="cursor-pointer text-xs">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? "bg-primary" : "bg-input"}`}
      >
        <span
          className={`pointer-events-none inline-block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}

// ─── task card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onEdit,
  onDelete,
  onToggle,
}: {
  task: ScheduledTaskDTO;
  onEdit: (t: ScheduledTaskDTO) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const isPrompt = task.task_type === "agent_prompt";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:border-primary/40 transition-colors">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {isPrompt ? <Bot size={16} /> : <ListTodo size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{task.name}</span>
          <Badge variant={task.active ? "default" : "secondary"} className="text-xs shrink-0">
            {task.active ? "activa" : "pausada"}
          </Badge>
          <Badge variant="outline" className="text-xs shrink-0">
            {isPrompt ? "prompt" : "lista"}
          </Badge>
        </div>
        {task.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">{task.description}</p>
        )}
        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock size={11} />
          <code className="font-mono">{task.cron_expr}</code>
          <ChevronRight size={11} />
          <span>{cronToHuman(task.cron_expr)}</span>
          <span className="text-muted-foreground/50">· {task.timezone}</span>
        </div>
        {task.last_run_at && (
          <p className="mt-1 text-xs text-muted-foreground/70">
            Última execução: {new Date(task.last_run_at).toLocaleString("pt-BR")}
            {task.run_count > 0 && <> · {task.run_count}×</>}
          </p>
        )}
        {task.last_error && (
          <p className="mt-0.5 text-xs text-destructive truncate">Erro: {task.last_error}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={task.active ? "Pausar" : "Activar"}
          onClick={() => onToggle(task.id, !task.active)}
        >
          {task.active ? <PowerOff size={14} /> : <Power size={14} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Editar"
          onClick={() => onEdit(task)}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          title="Apagar"
          onClick={() => onDelete(task.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

// ─── form panel ───────────────────────────────────────────────────────────────

function FormPanel({
  form,
  setForm,
  taskLists,
  editingId,
  saving,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  taskLists: TaskListDTO[];
  editingId: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {editingId ? "Editar automação" : "Nova automação"}
        </h3>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">Nome *</label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Ex: Resumo diário às 20h"
            className="h-8 text-sm"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-medium">Tipo</label>
          <Select
            value={form.task_type}
            onValueChange={(v) => set("task_type", v as TaskType)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent_prompt">Prompt ao agente</SelectItem>
              <SelectItem value="run_task_list">Executar lista de tarefas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.task_type === "agent_prompt" && (
          <>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">Prompt *</label>
              <Textarea
                value={form.prompt}
                onChange={(e) => set("prompt", e.target.value)}
                placeholder="Ex: Resume as minhas tarefas de hoje e envia por email."
                rows={3}
                className="text-sm resize-none"
              />
            </div>
            <Toggle
              id="send-email"
              checked={form.send_email}
              onChange={(v) => set("send_email", v)}
              label="Enviar resultado por email"
            />
            {form.send_email && (
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Assunto do email</label>
                <Input
                  value={form.email_subject}
                  onChange={(e) => set("email_subject", e.target.value)}
                  placeholder="Ex: Resumo do dia — Open Polvo"
                  className="h-8 text-sm"
                />
              </div>
            )}
            <Toggle
              id="inc-tasks"
              checked={form.include_tasks}
              onChange={(v) => set("include_tasks", v)}
              label="Incluir contexto de tarefas"
            />
            <Toggle
              id="inc-finance"
              checked={form.include_finance}
              onChange={(v) => set("include_finance", v)}
              label="Incluir contexto de finanças"
            />
          </>
        )}

        {form.task_type === "run_task_list" && (
          <div className="grid gap-1.5">
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
                  <SelectItem key={tl.id} value={tl.id}>
                    {tl.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-1.5">
          <label className="text-xs font-medium">Expressão CRON *</label>
          <div className="flex gap-2">
            <Input
              value={form.cron_expr}
              onChange={(e) => set("cron_expr", e.target.value)}
              placeholder="0 20 * * *"
              className="h-8 text-sm font-mono flex-1"
            />
            <Select onValueChange={(v) => set("cron_expr", String(v ?? ""))}>
              <SelectTrigger className="h-8 text-sm w-36">
                <SelectValue placeholder="Preset…" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.cron_expr && (
            <p className="text-xs text-muted-foreground">
              ↳ {cronToHuman(form.cron_expr)}
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-medium">Fuso horário</label>
          <Input
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="America/Sao_Paulo"
            className="h-8 text-sm"
          />
        </div>

        <Toggle
          id="task-active"
          checked={form.active}
          onChange={(v) => set("active", v)}
          label="Activar ao guardar"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1" onClick={onSave} disabled={saving}>
          {saving ? "A guardar…" : editingId ? "Guardar" : "Criar automação"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function AutomacoesPage() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<ScheduledTaskDTO[]>([]);
  const [taskLists, setTaskLists] = useState<TaskListDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ts, tls] = await Promise.all([
        listScheduledTasks(),
        token ? fetchTaskLists(token) : Promise.resolve([]),
      ]);
      setTasks(ts);
      setTaskLists(tls);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setShowForm(true);
  };

  const openEdit = (t: ScheduledTaskDTO) => {
    setEditingId(t.id);
    setForm(taskToForm(t));
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.cron_expr.trim()) return;
    if (form.task_type === "agent_prompt" && !form.prompt.trim()) return;
    if (form.task_type === "run_task_list" && !form.task_list_id) return;
    setSaving(true);
    try {
      const input = formToInput(form);
      if (editingId) {
        await updateScheduledTask(editingId, input);
      } else {
        await createScheduledTask(input);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Apagar esta automação?")) return;
    try {
      await deleteScheduledTask(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    try {
      await updateScheduledTask(id, { active });
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, active } : t)));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-primary" />
          <h1 className="text-sm font-semibold">Automações agendadas</h1>
          {tasks.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {tasks.filter((t) => t.active).length}/{tasks.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => void load()}
            title="Actualizar"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button size="sm" onClick={openNew} className="gap-1.5 h-7 text-xs px-3">
            <Plus size={13} />
            Nova
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="flex flex-1 overflow-hidden">
        {/* list */}
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {loading && tasks.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">A carregar…</p>
          )}

          {!loading && tasks.length === 0 && !showForm && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Clock size={22} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Sem automações ainda</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Cria uma automação aqui ou pede ao agente no chat:
                  <br />
                  <em>"Envia um email de resumo todo dia às 20h"</em>
                </p>
              </div>
              <Button size="sm" onClick={openNew} className="gap-1.5">
                <Plus size={13} />
                Criar automação
              </Button>
            </div>
          )}

          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onEdit={openEdit}
              onDelete={(id) => void handleDelete(id)}
              onToggle={(id, active) => void handleToggle(id, active)}
            />
          ))}
        </div>

        {/* form panel */}
        {showForm && (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-border p-4">
            <FormPanel
              form={form}
              setForm={setForm}
              taskLists={taskLists}
              editingId={editingId}
              saving={saving}
              onSave={() => void handleSave()}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
