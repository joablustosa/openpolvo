import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  ListTodo,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchTaskLists,
  createTaskList,
  deleteTaskList,
  runTaskList,
  type TaskListDTO,
  type TaskItemDTO,
} from "@/lib/taskListsApi";
import { useTaskListPolling } from "@/hooks/useTaskListPolling";

// ─── Utilitários ────────────────────────────────────────────────────────────

function statusColor(status: TaskItemDTO["status"]) {
  switch (status) {
    case "running":
      return "text-yellow-500";
    case "completed":
      return "text-green-500";
    case "failed":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

function listStatusDot(status: TaskListDTO["status"]) {
  switch (status) {
    case "running":
      return <span className="size-2 rounded-full bg-yellow-400 shrink-0" />;
    case "completed":
      return <span className="size-2 rounded-full bg-green-500 shrink-0" />;
    case "failed":
      return <span className="size-2 rounded-full bg-red-500 shrink-0" />;
    default:
      return <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />;
  }
}

// ─── TaskItemRow ─────────────────────────────────────────────────────────────

function TaskItemRow({ item }: { item: TaskItemDTO }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(item.result ?? item.error_msg);

  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        {/* Ícone de estado */}
        <span className={cn("mt-0.5 shrink-0", statusColor(item.status))}>
          {item.status === "pending" && <Circle className="size-4" />}
          {item.status === "running" && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {item.status === "completed" && <CheckCircle2 className="size-4" />}
          {item.status === "failed" && <XCircle className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={open ? "Fechar detalhe" : "Ver detalhe"}
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        )}
      </div>

      {open && hasDetail && (
        <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground/80 whitespace-pre-wrap">
          {item.result ?? item.error_msg}
        </div>
      )}
    </div>
  );
}

// ─── TaskItemForm ─────────────────────────────────────────────────────────────

type DraftItem = { title: string; description: string };

function TaskItemForm({
  items,
  onChange,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function add() {
    const t = title.trim();
    if (!t) return;
    onChange([...items, { title: t, description: description.trim() }]);
    setTitle("");
    setDescription("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Input
          placeholder="Título da tarefa"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Textarea
          placeholder="Descrição (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="resize-none text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={add}
          disabled={!title.trim()}
        >
          <Plus className="size-3.5" />
          Adicionar tarefa
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm"
            >
              <span className="flex-1 truncate">{item.title}</span>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remover tarefa"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── ActiveView ───────────────────────────────────────────────────────────────

function ActiveView({
  list,
  token,
  onDeleted,
}: {
  list: TaskListDTO;
  token: string;
  onDeleted: () => void;
}) {
  const polled = useTaskListPolling(list.id, token, list);
  const data = polled ?? list;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      await runTaskList(token, list.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao activar agente");
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteTaskList(token, list.id);
      onDeleted();
    } catch {
      // silencioso
    }
  }

  const isTerminal = data.status === "completed" || data.status === "failed";
  const canRun = data.status === "pending" && (data.items?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{data.title}</h2>
          <p className="text-xs capitalize text-muted-foreground">{data.status}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Eliminar lista"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Itens */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {(data.items ?? []).map((item) => (
          <TaskItemRow key={item.id} item={item} />
        ))}
        {(data.items ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Sem tarefas nesta lista.</p>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {/* Botão executar */}
      {!isTerminal && (
        <Button
          className="w-full gap-2"
          disabled={!canRun || data.status === "running" || running}
          onClick={() => void handleRun()}
        >
          {data.status === "running" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              A executar…
            </>
          ) : (
            "Ativar Agente"
          )}
        </Button>
      )}

      {isTerminal && (
        <p className="text-center text-xs text-muted-foreground">
          {data.status === "completed"
            ? "Todas as tarefas concluídas."
            : "Execução terminada com erros."}
        </p>
      )}
    </div>
  );
}

// ─── NewListView ──────────────────────────────────────────────────────────────

function NewListView({
  token,
  onCreate,
}: {
  token: string;
  onCreate: (list: TaskListDTO) => void;
}) {
  const [listTitle, setListTitle] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const title = listTitle.trim();
    if (!title || items.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const tl = await createTaskList(token, { title, items });
      onCreate(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar lista");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <h2 className="text-lg font-semibold">Nova lista de tarefas</h2>

      <Input
        placeholder="Título da lista"
        value={listTitle}
        onChange={(e) => setListTitle(e.target.value)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskItemForm items={items} onChange={setItems} />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <Button
        className="w-full"
        disabled={!listTitle.trim() || items.length === 0 || saving}
        onClick={() => void handleCreate()}
      >
        {saving ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            A criar…
          </>
        ) : (
          "Criar lista"
        )}
      </Button>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function AgenteTarefasPage() {
  const { token } = useAuth();
  const [lists, setLists] = useState<TaskListDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadLists = useCallback(async () => {
    if (!token) return;
    setLoadingList(true);
    try {
      const data = await fetchTaskLists(token);
      if (mountedRef.current) setLists(data);
    } catch {
      // silencioso
    } finally {
      if (mountedRef.current) setLoadingList(false);
    }
  }, [token]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  function handleCreated(tl: TaskListDTO) {
    setLists((prev) => [tl, ...prev]);
    setSelectedId(tl.id);
    setCreating(false);
  }

  function handleDeleted() {
    setSelectedId(null);
    void loadLists();
  }

  const selected = lists.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0">
      {/* ── Painel esquerdo: histórico ── */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-border/80 bg-muted/25">
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ListTodo className="size-4 shrink-0" />
            Listas de tarefas
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Nova lista"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loadingList ? (
            <p className="px-1 text-xs text-muted-foreground">A carregar…</p>
          ) : lists.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              Nenhuma lista ainda. Crie uma nova.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(l.id);
                      setCreating(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/80",
                      selectedId === l.id &&
                        !creating &&
                        "bg-muted font-medium text-foreground",
                    )}
                  >
                    {listStatusDot(l.status)}
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Painel direito: editor / visualizador ── */}
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        {creating && token ? (
          <NewListView token={token} onCreate={handleCreated} />
        ) : selected && token ? (
          <ActiveView
            key={selected.id}
            list={selected}
            token={token}
            onDeleted={handleDeleted}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <ListTodo className="size-10 opacity-30" />
            <p className="text-sm">
              Selecione uma lista ou crie uma nova.
            </p>
            {token && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus className="mr-1.5 size-3.5" />
                Nova lista
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
