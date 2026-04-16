import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ArrowLeft,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Save,
  Sparkles,
  Clock,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import type { ModelProvider } from "@/lib/conversationsApi";
import { partitionWorkflowsForNav } from "@/lib/workflowsNavOrder";
import type {
  WorkflowDTO,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "@/lib/workflowsApi";
import * as wf from "@/lib/workflowsApi";

const WF_TYPES = ["schedule", "goto", "click", "fill", "wait", "llm"] as const;

const TZ_PRESETS = [
  "UTC",
  "Europe/Lisbon",
  "Europe/Madrid",
  "America/Sao_Paulo",
  "America/New_York",
] as const;

const KNOWN_WF_TYPES = new Set<string>(WF_TYPES);

function normalizeWorkflowNodeType(t: string): string {
  return KNOWN_WF_TYPES.has(t) ? t : "goto";
}

function graphToFlow(g: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (g.nodes ?? []).map((n) => ({
    id: n.id,
    type: normalizeWorkflowNodeType(n.type),
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
      timeout_ms: (n.data as { timeout_ms?: number }).timeout_ms,
      label: (n.data as { label?: string }).label,
      cron: (n.data as { cron?: string }).cron,
      timezone: (n.data as { timezone?: string }).timezone,
      schedule_enabled: (n.data as { schedule_enabled?: boolean }).schedule_enabled,
    },
  }));
  const ge: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return { nodes: gn, edges: ge };
}

function WfNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const label = (data?.label as string) || String(props.type ?? "nó");
  const isSchedule = String(props.type) === "schedule";
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !border-border !bg-muted !opacity-100"
      />
      <div
        className={cn(
          "min-w-[160px] rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm",
          isSchedule
            ? "border-violet-500/60 ring-1 ring-violet-500/25"
            : "border-border",
        )}
      >
        <div className="flex items-center gap-1 font-medium text-foreground">
          {isSchedule ? (
            <Clock className="size-3 shrink-0 text-violet-600 dark:text-violet-400" />
          ) : null}
          <span className="truncate">{label}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {String(props.type ?? "—")}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border !border-border !bg-muted !opacity-100"
      />
    </>
  );
}

const nodeTypes = {
  default: WfNode,
  schedule: WfNode,
  goto: WfNode,
  click: WfNode,
  fill: WfNode,
  wait: WfNode,
  llm: WfNode,
};

type WorkflowListItemProps = {
  workflow: WorkflowDTO;
  isActive: boolean;
  onSelect: () => void;
  onRename: (id: string, newTitle: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

function WorkflowListItem({
  workflow,
  isActive,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: WorkflowListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isPinned = Boolean(workflow.pinned_at);

  function startEdit() {
    setDraft(workflow.title?.trim() ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const val = draft.trim();
    if (val && val !== workflow.title?.trim()) {
      onRename(workflow.id, val);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="px-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 text-xs"
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          autoFocus
        />
      </li>
    );
  }

  return (
    <li className="group relative flex items-center">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/80",
          isActive && "bg-primary/15 font-medium text-foreground",
        )}
      >
        {isPinned && (
          <Pin className="mr-0.5 inline-block size-2.5 opacity-50" />
        )}
        {workflow.title?.trim() || "Workflow sem título"}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          nativeButton
          render={
            <button
              type="button"
              className={cn(
                "absolute right-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100",
                isActive && "opacity-100",
              )}
              aria-label="Opções do workflow"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={startEdit}>
            <Pencil className="mr-2 size-3.5" />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPin(workflow.id, !isPinned)}>
            {isPinned ? (
              <>
                <PinOff className="mr-2 size-3.5" />
                Desafixar
              </>
            ) : (
              <>
                <Pin className="mr-2 size-3.5" />
                Fixar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(workflow.id)}
          >
            <Trash2 className="mr-2 size-3.5" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function PuloDoGatoPage() {
  const { token } = useAuth();
  const [list, setList] = useState<WorkflowDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("Novo workflow");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selNodeId, setSelNodeId] = useState<string | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const [recording, setRecording] = useState("");
  const [modelProvider, setModelProvider] = useState<ModelProvider>("openai");
  const [genBusy, setGenBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { pinned: pinnedWf, recent: recentWf } = useMemo(
    () => partitionWorkflowsForNav(list),
    [list],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selNodeId) ?? null,
    [nodes, selNodeId],
  );

  const selectedListWf = useMemo(
    () => list.find((w) => w.id === selectedId) ?? null,
    [list, selectedId],
  );

  const refreshList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const w = await wf.fetchWorkflows(token);
      setList(w);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const handleRenameWorkflow = useCallback(
    async (id: string, newTitle: string) => {
      if (!token) return;
      setErr(null);
      try {
        await wf.updateWorkflow(token, id, { title: newTitle });
        if (selectedId === id) setTitle(newTitle);
        await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro ao renomear");
      }
    },
    [token, selectedId, refreshList],
  );

  const handlePinWorkflow = useCallback(
    async (id: string, pinned: boolean) => {
      if (!token) return;
      setErr(null);
      try {
        await wf.pinWorkflow(token, id, pinned);
        await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro ao fixar");
      }
    },
    [token, refreshList],
  );

  const loadWorkflow = useCallback(
    async (id: string) => {
      if (!token) return;
      setErr(null);
      try {
        const w = await wf.getWorkflow(token, id);
        setSelectedId(w.id);
        setTitle(w.title);
        const { nodes: ns, edges: es } = graphToFlow(w.graph);
        setNodes(ns);
        setEdges(es);
        setSelNodeId(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro");
      }
    },
    [token, setNodes, setEdges],
  );

  const newWorkflow = useCallback(() => {
    setSelectedId(null);
    setTitle("Novo workflow");
    setNodes([
      {
        id: "n-sched",
        type: "schedule",
        position: { x: 80, y: 40 },
        data: {
          label: "Agendamento",
          cron: "0 9 * * *",
          timezone: "Europe/Lisbon",
          schedule_enabled: true,
        },
      },
      {
        id: "n1",
        type: "goto",
        position: { x: 80, y: 200 },
        data: { label: "Abrir URL", url: "https://example.com" },
      },
    ]);
    setEdges([
      {
        id: "e-sched-goto",
        source: "n-sched",
        target: "n1",
      },
    ]);
    setSelNodeId("n-sched");
  }, [setNodes, setEdges]);

  const handleDeleteWorkflow = useCallback(
    async (id: string) => {
      if (!token) return;
      setErr(null);
      try {
        if (selectedId === id) {
          newWorkflow();
        }
        await wf.deleteWorkflow(token, id);
        await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro ao excluir");
      }
    },
    [token, selectedId, newWorkflow, refreshList],
  );

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            id: `e-${c.source}-${c.target}-${eds.length}`,
          },
          eds,
        ),
      ),
    [setEdges],
  );

  const save = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const graph = flowToGraph(nodes, edges);
    try {
      if (selectedId) {
        const w = await wf.updateWorkflow(token, selectedId, {
          title,
          graph,
        });
        setSelectedId(w.id);
        await refreshList();
      } else {
        const w = await wf.createWorkflow(token, { title, graph });
        setSelectedId(w.id);
        await refreshList();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    }
  }, [token, selectedId, title, nodes, edges, refreshList]);

  const run = useCallback(async () => {
    if (!token || !selectedId) {
      setErr("Guarde o workflow antes de executar.");
      return;
    }
    setRunBusy(true);
    setErr(null);
    try {
      const r = await wf.runWorkflow(token, selectedId);
      setLastRun(JSON.stringify(r, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro na execução");
    } finally {
      setRunBusy(false);
    }
  }, [token, selectedId]);

  const generate = useCallback(async () => {
    if (!token || !genPrompt.trim()) return;
    setGenBusy(true);
    setErr(null);
    try {
      const res = await wf.generateWorkflow(token, {
        prompt: genPrompt,
        recording_json: recording.trim() || undefined,
        model_provider: modelProvider,
      });
      const { nodes: ns, edges: es } = graphToFlow(res.graph);
      setNodes(ns);
      setEdges(es);
      if (!title || title === "Novo workflow") {
        setTitle("Workflow gerado");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro na geração");
    } finally {
      setGenBusy(false);
    }
  }, [token, genPrompt, recording, modelProvider, title, setNodes, setEdges]);

  const addNode = useCallback(
    (t: (typeof WF_TYPES)[number]) => {
      const id = `n-${Date.now()}`;
      const base =
        t === "schedule"
          ? {
              label: "Agendamento",
              cron: "0 9 * * *",
              timezone: "Europe/Lisbon",
              schedule_enabled: true,
            }
          : { label: t };
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: t,
          position: { x: 120 + ns.length * 40, y: 120 + ns.length * 20 },
          data: base,
        },
      ]);
      setSelNodeId(id);
    },
    [setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selNodeId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selNodeId));
    setEdges((es) =>
      es.filter((e) => e.source !== selNodeId && e.target !== selNodeId),
    );
    setSelNodeId(null);
  }, [selNodeId, setNodes, setEdges]);

  const updateNodeData = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selNodeId) return;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === selNodeId
            ? { ...n, data: { ...n.data, ...patch } }
            : n,
        ),
      );
    },
    [selNodeId, setNodes],
  );

  if (!token) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para usar o Pulo do Gato.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
        >
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Sparkles className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Pulo do Gato</h1>
        <span className="text-xs text-muted-foreground">
          Playwright + LLM · agendamento cron no servidor
        </span>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        {/* Lista */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-muted/20">
          <div className="flex items-center gap-1 border-b border-border p-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={newWorkflow}>
              <Plus className="mr-1 size-3" />
              Novo
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title="Actualizar lista"
              onClick={() => void refreshList()}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            <div className="mb-3">
              <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Pin className="size-3" />
                Fixados
              </div>
              {pinnedWf.length === 0 ? (
                <p className="px-1 text-[11px] text-muted-foreground/80">
                  Nenhum workflow fixado.
                </p>
              ) : (
                <ul className="space-y-0.5 text-muted-foreground">
                  {pinnedWf.map((w) => (
                    <WorkflowListItem
                      key={w.id}
                      workflow={w}
                      isActive={selectedId === w.id}
                      onSelect={() => void loadWorkflow(w.id)}
                      onRename={handleRenameWorkflow}
                      onPin={handlePinWorkflow}
                      onDelete={handleDeleteWorkflow}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <History className="size-3" />
                Recentes
              </div>
              {loading ? (
                <p className="px-1 text-[11px] text-muted-foreground/80">
                  A carregar…
                </p>
              ) : recentWf.length === 0 ? (
                <p className="px-1 text-[11px] text-muted-foreground/80">
                  {pinnedWf.length > 0
                    ? "Sem mais workflows (além dos fixados)."
                    : "Nenhum workflow. Crie um novo ou gere com a LLM."}
                </p>
              ) : (
                <ul className="space-y-0.5 text-muted-foreground">
                  {recentWf.map((w) => (
                    <WorkflowListItem
                      key={w.id}
                      workflow={w}
                      isActive={selectedId === w.id}
                      onSelect={() => void loadWorkflow(w.id)}
                      onRename={handleRenameWorkflow}
                      onPin={handlePinWorkflow}
                      onDelete={handleDeleteWorkflow}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <div className="relative h-full min-h-0 min-w-0 w-full flex-1 pulo-do-gato-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            onNodeClick={(_, n) => setSelNodeId(n.id)}
            onPaneClick={() => setSelNodeId(null)}
            className="h-full w-full bg-muted/10 [&_.react-flow__edge-path]:stroke-border [&_.react-flow__connectionline]:stroke-border"
          >
            <Background gap={16} size={1} className="opacity-40" />
            <Controls
              className="overflow-hidden rounded-md border border-border bg-card shadow-md [&_button]:border-border [&_button]:bg-background [&_button]:text-foreground [&_button:hover]:bg-muted [&_button]:disabled:opacity-40"
            />
            <MiniMap
              className="!rounded-md !border !border-border !bg-card/95"
              maskColor="rgba(0,0,0,0.45)"
              nodeStrokeColor="var(--border)"
              nodeColor={() => "var(--muted)"}
            />
            <Panel position="top-left" className="flex flex-wrap gap-1">
              {WF_TYPES.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px]"
                  onClick={() => addNode(t)}
                >
                  + {t}
                </Button>
              ))}
            </Panel>
          </ReactFlow>
        </div>

        {/* Inspector + LLM */}
        <aside className="flex w-[min(100%,320px)] shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-card/40 p-3">
          <div>
            <label className="text-[10px] font-medium uppercase text-muted-foreground">
              Título
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 h-8 text-sm"
            />
            {selectedListWf?.schedule_enabled &&
            (selectedListWf.schedule_cron ?? "").trim() !== "" ? (
              <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                Agendamento no servidor:{" "}
                <code className="rounded bg-muted px-1 font-mono text-[10px]">
                  {selectedListWf.schedule_cron}
                </code>
                {" · "}
                {selectedListWf.schedule_timezone ?? "UTC"}
                {selectedListWf.schedule_last_fired_at ? (
                  <>
                    {" · último: "}
                    {new Date(
                      selectedListWf.schedule_last_fired_at,
                    ).toLocaleString()}
                  </>
                ) : (
                  " · ainda não disparou"
                )}
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="flex-1 gap-1" onClick={() => void save()}>
              <Save className="size-3.5" />
              Guardar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 gap-1"
              disabled={!selectedId || runBusy}
              onClick={() => void run()}
            >
              {runBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Executar
            </Button>
          </div>

          {selectedNode ? (
            <div className="space-y-2 rounded-md border border-border bg-background/80 p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Nó seleccionado</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={deleteSelected}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={String(selectedNode.type)}
                onChange={(e) => {
                  const v = e.target.value;
                  setNodes((ns) =>
                    ns.map((n) =>
                      n.id === selNodeId ? { ...n, type: v } : n,
                    ),
                  );
                }}
              >
                {WF_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Etiqueta"
                className="h-8 text-xs"
                value={String((selectedNode.data as { label?: string }).label ?? "")}
                onChange={(e) => updateNodeData({ label: e.target.value })}
              />
              {"goto" === selectedNode.type ? (
                <Input
                  placeholder="URL"
                  className="h-8 text-xs"
                  value={String((selectedNode.data as { url?: string }).url ?? "")}
                  onChange={(e) => updateNodeData({ url: e.target.value })}
                />
              ) : null}
              {["click", "fill", "wait"].includes(String(selectedNode.type)) ? (
                <Input
                  placeholder="Selector CSS"
                  className="h-8 text-xs"
                  value={String(
                    (selectedNode.data as { selector?: string }).selector ?? "",
                  )}
                  onChange={(e) => updateNodeData({ selector: e.target.value })}
                />
              ) : null}
              {String(selectedNode.type) === "fill" ? (
                <Input
                  placeholder="Texto"
                  className="h-8 text-xs"
                  value={String((selectedNode.data as { value?: string }).value ?? "")}
                  onChange={(e) => updateNodeData({ value: e.target.value })}
                />
              ) : null}
              {String(selectedNode.type) === "llm" ? (
                <Textarea
                  placeholder="Mini-prompt"
                  className="min-h-[72px] text-xs"
                  value={String(
                    (selectedNode.data as { prompt?: string }).prompt ?? "",
                  )}
                  onChange={(e) => updateNodeData({ prompt: e.target.value })}
                />
              ) : null}
              {String(selectedNode.type) === "schedule" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    O servidor API executa este workflow no horário definido (cron de 5
                    campos). Desligue o toggle para só correr manualmente com
                    «Executar».
                  </p>
                  <Input
                    placeholder="Cron — ex. 0 9 * * *"
                    className="h-8 font-mono text-[11px]"
                    value={String(
                      (selectedNode.data as { cron?: string }).cron ?? "",
                    )}
                    onChange={(e) => updateNodeData({ cron: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      onClick={() =>
                        updateNodeData({ cron: "0 9 * * *", schedule_enabled: true })
                      }
                    >
                      Diário 9h
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      onClick={() =>
                        updateNodeData({ cron: "0 * * * *", schedule_enabled: true })
                      }
                    >
                      Cada hora
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px]"
                      onClick={() =>
                        updateNodeData({
                          cron: "*/15 * * * *",
                          schedule_enabled: true,
                        })
                      }
                    >
                      15 min
                    </Button>
                  </div>
                  <label className="text-[10px] text-muted-foreground">
                    Fuso horário (IANA)
                  </label>
                  <select
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={
                      (selectedNode.data as { timezone?: string }).timezone ||
                      "Europe/Lisbon"
                    }
                    onChange={(e) =>
                      updateNodeData({ timezone: e.target.value })
                    }
                  >
                    {TZ_PRESETS.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="size-3.5 rounded border-input"
                      checked={Boolean(
                        (selectedNode.data as { schedule_enabled?: boolean })
                          .schedule_enabled,
                      )}
                      onChange={(e) =>
                        updateNodeData({ schedule_enabled: e.target.checked })
                      }
                    />
                    Agendamento activo
                  </label>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Clique num nó para editar propriedades.
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[10px] font-medium uppercase text-muted-foreground">
              Pedir à LLM (workflow)
            </p>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={modelProvider}
              onChange={(e) =>
                setModelProvider(e.target.value as ModelProvider)
              }
            >
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
            </select>
            <Textarea
              placeholder="Descreve a automação que queres (ex.: abrir SmartBus e clicar em login)…"
              className="min-h-[80px] text-xs"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
            />
            <Textarea
              placeholder="Gravação bruta / trace JSON (opcional)"
              className="min-h-[56px] text-[10px] text-muted-foreground"
              value={recording}
              onChange={(e) => setRecording(e.target.value)}
            />
            <Button
              size="sm"
              className="w-full gap-1"
              disabled={genBusy || !genPrompt.trim()}
              onClick={() => void generate()}
            >
              {genBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              Gerar grafo
            </Button>
          </div>

          {err ? (
            <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {err}
            </p>
          ) : null}

          {lastRun ? (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-muted-foreground">
                Última execução
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 p-2 whitespace-pre-wrap">
                {lastRun}
              </pre>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
