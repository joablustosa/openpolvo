/**
 * Grafo de execução de workflow (Pulo do Gato) em modo leitura.
 *
 * Reutiliza o mesmo layout XYFlow do editor, mas:
 *  - Sem edição (nodesDraggable=false, nodesConnectable=false, edgesFocusable=false)
 *  - Cada nó recebe um estado de execução derivado do step_log do último run
 *  - Nó em erro fica vermelho; nó em execução fica azul pulsante; sucesso fica verde
 */
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, CheckCircle2, Clock, Loader2, Mail, MousePointer, Pencil, Wand2, XCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowDTO, WorkflowRunDTO } from "@/lib/workflowsApi";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type NodeExecStatus = "idle" | "running" | "success" | "error";

// ── Injectar estado de execução nos nós ───────────────────────────────────────

/**
 * A partir do step_log de um WorkflowRunDTO, devolve um Map<nodeId, NodeExecStatus>.
 */
export function buildNodeExecMap(
  run: WorkflowRunDTO | null,
  runningNodeId?: string,
): Map<string, NodeExecStatus> {
  const map = new Map<string, NodeExecStatus>();
  if (runningNodeId) {
    map.set(runningNodeId, "running");
    return map;
  }
  if (!run?.step_log) return map;
  for (const step of run.step_log) {
    map.set(step.node_id, step.ok ? "success" : "error");
  }
  return map;
}

/**
 * Injeta `_execStatus` e `_execMessage` em cada nó para o componente ler.
 */
function injectExecState(
  nodes: Node[],
  execMap: Map<string, NodeExecStatus>,
  run: WorkflowRunDTO | null,
): Node[] {
  return nodes.map((n) => {
    const status = execMap.get(n.id) ?? "idle";
    const stepEntry = run?.step_log?.find((s) => s.node_id === n.id);
    return {
      ...n,
      data: {
        ...n.data,
        _execStatus: status,
        _execMessage: stepEntry?.message ?? null,
      },
    };
  });
}

// ── Nó customizado com estado de execução ─────────────────────────────────────

function nodeIcon(type: string) {
  switch (type) {
    case "schedule":  return <Clock className="size-3 text-violet-500" />;
    case "send_email": return <Mail className="size-3 text-amber-500" />;
    case "llm":       return <Wand2 className="size-3 text-blue-500" />;
    case "web_search": return <Search className="size-3 text-sky-500" />;
    case "goto":      return <MousePointer className="size-3 text-muted-foreground" />;
    case "click":     return <MousePointer className="size-3 text-muted-foreground" />;
    case "fill":      return <Pencil className="size-3 text-muted-foreground" />;
    case "wait":      return <Clock className="size-3 text-muted-foreground" />;
    default:          return <Bot className="size-3 text-muted-foreground" />;
  }
}

function ExecNode(props: NodeProps) {
  const data = props.data as Record<string, unknown>;
  const label = (data?.label as string) || String(props.type ?? "nó");
  const status = (data?._execStatus as NodeExecStatus) ?? "idle";
  const message = (data?._execMessage as string | null) ?? null;

  const containerClass = cn(
    "min-w-[150px] rounded-lg border-2 bg-card px-2.5 py-2 text-xs shadow-sm transition-all duration-300",
    status === "running" && "border-blue-500 bg-blue-500/8 shadow-blue-500/25 animate-[pulse_2s_ease-in-out_infinite]",
    status === "success" && "border-emerald-500 bg-emerald-500/5",
    status === "error" && "border-red-500 bg-red-500/8",
    status === "idle" && "border-border",
  );

  const statusIcon =
    status === "running" ? <Loader2 className="size-3 animate-spin text-blue-500" /> :
    status === "success" ? <CheckCircle2 className="size-3 text-emerald-500" /> :
    status === "error" ? <XCircle className="size-3 text-red-500" /> :
    null;

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border !border-border !bg-muted !opacity-100"
      />
      <div className={containerClass}>
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          {nodeIcon(String(props.type ?? ""))}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {statusIcon}
        </div>
        <div
          className={cn(
            "text-[10px]",
            status === "error" ? "text-red-500" : "text-muted-foreground",
          )}
        >
          {message ? (
            <span className="block max-w-[180px] truncate" title={message}>
              {message}
            </span>
          ) : (
            <span>{String(props.type ?? "—")}</span>
          )}
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

const execNodeTypes = {
  default: ExecNode,
  schedule: ExecNode,
  goto: ExecNode,
  click: ExecNode,
  fill: ExecNode,
  wait: ExecNode,
  llm: ExecNode,
  send_email: ExecNode,
};

// ── Converter WorkflowGraph para XYFlow ───────────────────────────────────────

function graphToFlow(workflow: WorkflowDTO): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (workflow.graph.nodes ?? []).map((n, i) => ({
    id: n.id,
    type: n.type || "goto",
    position: n.position ?? { x: i * 200, y: 0 },
    data: { ...n.data, label: n.data.label ?? n.type },
  }));
  const edges: Edge[] = (workflow.graph.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return { nodes, edges };
}

// ── Estilizar edges com base no estado de execução ───────────────────────────

function styledEdges(edges: Edge[], execMap: Map<string, NodeExecStatus>): Edge[] {
  return edges.map((e) => {
    const srcStatus = execMap.get(e.source) ?? "idle";
    return {
      ...e,
      style: {
        stroke:
          srcStatus === "success" ? "#10b981" :
          srcStatus === "error"   ? "#ef4444" :
          srcStatus === "running" ? "#3b82f6" :
          "#e2e8f0",
        strokeWidth: srcStatus !== "idle" ? 2 : 1,
      },
    };
  });
}

// ── Componente principal ───────────────────────────────────────────────────────

interface AutomacaoWorkflowFlowProps {
  workflow: WorkflowDTO;
  lastRun: WorkflowRunDTO | null;
  running?: boolean;
}

export function AutomacaoWorkflowFlow({ workflow, lastRun, running = false }: AutomacaoWorkflowFlowProps) {
  const execMap = useMemo(
    () => buildNodeExecMap(running ? null : lastRun),
    [lastRun, running],
  );

  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => graphToFlow(workflow),
    [workflow],
  );

  const nodes = useMemo(
    () => injectExecState(rawNodes, execMap, running ? null : lastRun),
    [rawNodes, execMap, lastRun, running],
  );

  const edges = useMemo(
    () => styledEdges(rawEdges, execMap),
    [rawEdges, execMap],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={execNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
