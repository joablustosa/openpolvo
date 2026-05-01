/**
 * Automação por workflows (grafo com agendamento cron, LLM, e-mail e redes sociais).
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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mail,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Share2,
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
import { cronToHuman } from "@/lib/cronHumanPt";
import * as wf from "@/lib/workflowsApi";
import type {
  WorkflowDTO,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowRunDTO,
} from "@/lib/workflowsApi";
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
  "post_facebook",
  "post_instagram",
  "post_linkedin",
  "post_whatsapp",
  "post_x",
  "post_twitter",
  "post_youtube",
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
  post_facebook: {
    labelPt: "Facebook (Meta)",
    descricaoCurta: "Publicar legenda/imagem via API Meta",
  },
  post_instagram: {
    labelPt: "Instagram (Meta)",
    descricaoCurta: "Publicar legenda/imagem via API Meta",
  },
  post_linkedin: {
    labelPt: "LinkedIn (rascunho)",
    descricaoCurta: "Gera texto com IA para colar na rede",
  },
  post_whatsapp: {
    labelPt: "WhatsApp (Meta)",
    descricaoCurta: "Mensagem de texto para número configurado",
  },
  post_x: {
    labelPt: "X / Twitter (rascunho)",
    descricaoCurta: "Gera post com IA (copiar para X)",
  },
  post_twitter: {
    labelPt: "Twitter (alias X)",
    descricaoCurta: "Igual a X — rascunho por IA",
  },
  post_youtube: {
    labelPt: "YouTube (rascunho)",
    descricaoCurta: "Título/descrição Short ou vídeo longo",
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
    case "post_facebook":
    case "post_instagram":
      return {
        label: meta.labelPt,
        caption: "{{previous}}",
        image_url: "",
        posts_per_day: 1,
      };
    case "post_whatsapp":
      return {
        label: meta.labelPt,
        whatsapp_to: "",
        caption: "{{previous}}",
        posts_per_day: 3,
      };
    case "post_linkedin":
    case "post_x":
    case "post_twitter":
      return {
        label: meta.labelPt,
        prompt:
          "Tom profissional PT-PT. Inclui hashtags relevantes (máx. 5). Respeita limites da plataforma.",
        caption: "",
        link_url: "",
        video_url: "",
        posts_per_day: 1,
      };
    case "post_youtube":
      return {
        label: meta.labelPt,
        youtube_format: "short",
        prompt:
          "Gera título chamativo, descrição com capítulos sugeridos e tags para YouTube em português.",
        caption: "Tema ou ângulo do vídeo…",
        link_url: "",
        video_url: "",
        posts_per_day: 1,
      };
    default:
      return { label: meta.labelPt };
  }
}

type WorkflowTemplateKey =
  | "email"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "whatsapp"
  | "x"
  | "youtube_short"
  | "youtube_long";

const TEMPLATE_TITLES: Record<WorkflowTemplateKey, string> = {
  email: "Workflow — e-mail agendado",
  facebook: "Workflow — Facebook",
  instagram: "Workflow — Instagram",
  linkedin: "Workflow — LinkedIn (rascunho)",
  whatsapp: "Workflow — WhatsApp",
  x: "Workflow — X (Twitter)",
  youtube_short: "Workflow — YouTube Shorts",
  youtube_long: "Workflow — YouTube (vídeo longo)",
};

/** Grafo inicial: schedule → LLM → nó de acção (ajuste cron e prompts). */
function workflowTemplateGraph(key: WorkflowTemplateKey): WorkflowGraph {
  const p = Date.now();
  const sched = `sched-${p}`;
  const llm = `llm-${p}`;
  const tail = `act-${p}`;
  const baseSched = {
    label: "Agendamento",
    cron: "0 9 * * *",
    timezone: "Europe/Lisbon",
    schedule_enabled: true,
  };
  const nodes: WorkflowGraph["nodes"] = [
    { id: sched, type: "schedule", position: { x: 60, y: 30 }, data: { ...baseSched } },
    {
      id: llm,
      type: "llm",
      position: { x: 60, y: 170 },
      data: {
        label: "Conteúdo (IA)",
        prompt: "",
      },
    },
  ];
  const edges: WorkflowGraph["edges"] = [
    { id: `e-${sched}-${llm}`, source: sched, target: llm },
  ];

  if (key === "email") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Escreve o corpo de um e-mail claro em português com base no tema do negócio. Usa tom profissional e call-to-action no fim.",
    };
    nodes.push({
      id: tail,
      type: "send_email",
      position: { x: 60, y: 320 },
      data: {
        label: "Enviar e-mail",
        email_to: "",
        email_subject: "{{previous}}",
        email_body: "{{previous}}",
      },
    });
  } else if (key === "facebook") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Especialista Facebook: legenda até ~500 caracteres, tom humano, 1–3 emojis no máximo, pergunta no fim para engagement. Inclui linha opcional com #hashtags relevantes (máx. 5).",
    };
    nodes.push({
      id: tail,
      type: "post_facebook",
      position: { x: 60, y: 320 },
      data: {
        label: "Publicar Facebook",
        caption: "{{previous}}",
        image_url: "",
        posts_per_day: 1,
      },
    });
  } else if (key === "instagram") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Especialista Instagram: legenda com gancho na 1ª linha, corpo com valor ou história, hashtags no bloco final (10–20), tom autêntico.",
    };
    nodes.push({
      id: tail,
      type: "post_instagram",
      position: { x: 60, y: 320 },
      data: {
        label: "Publicar Instagram",
        caption: "{{previous}}",
        image_url: "",
        posts_per_day: 1,
      },
    });
  } else if (key === "linkedin") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Especialista LinkedIn: post B2B, primeira linha forte, parágrafos curtos, insight ou opinião, CTA suave. Sem hashtag excessiva (3–5).",
    };
    nodes.push({
      id: tail,
      type: "post_linkedin",
      position: { x: 60, y: 320 },
      data: {
        label: "Rascunho LinkedIn",
        caption: "{{previous}}",
        link_url: "",
        posts_per_day: 1,
      },
    });
  } else if (key === "whatsapp") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Especialista WhatsApp: mensagem curta, cordial, objectivo claro (lembrete, promoção ou follow-up). Evita spam; máx. ~400 caracteres.",
    };
    nodes.push({
      id: tail,
      type: "post_whatsapp",
      position: { x: 60, y: 320 },
      data: {
        label: "Enviar WhatsApp",
        whatsapp_to: "",
        caption: "{{previous}}",
        posts_per_day: 3,
      },
    });
  } else if (key === "x") {
    nodes[1].data = {
      ...nodes[1].data,
      prompt:
        "Especialista X (Twitter): até 280 caracteres se possível, voz directa, 0–2 hashtags, opcional thread (se pedido, separa com ---).",
    };
    nodes.push({
      id: tail,
      type: "post_x",
      position: { x: 60, y: 320 },
      data: {
        label: "Rascunho X",
        caption: "{{previous}}",
        posts_per_day: 4,
      },
    });
  } else {
    const isShort = key === "youtube_short";
    nodes[1].data = {
      ...nodes[1].data,
      prompt: isShort
        ? "Especialista YouTube Shorts: título <60 caracteres, descrição curta com 2–3 hashtags, gancho nos primeiros segundos sugeridos em texto."
        : "Especialista YouTube longo: título SEO, descrição com timestamps sugeridos, tags e parágrafo sobre o público-alvo.",
    };
    nodes.push({
      id: tail,
      type: "post_youtube",
      position: { x: 60, y: 320 },
      data: {
        label: isShort ? "Rascunho Shorts" : "Rascunho vídeo longo",
        youtube_format: isShort ? "short" : "long",
        caption: "{{previous}}",
        link_url: "",
        video_url: "",
        posts_per_day: 1,
      },
    });
  }

  edges.push({ id: `e-${llm}-${tail}`, source: llm, target: tail });
  return { nodes, edges };
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
      caption: (n.data as { caption?: string }).caption,
      image_url: (n.data as { image_url?: string }).image_url,
      video_url: (n.data as { video_url?: string }).video_url,
      link_url: (n.data as { link_url?: string }).link_url,
      whatsapp_to: (n.data as { whatsapp_to?: string }).whatsapp_to,
      youtube_format: (n.data as { youtube_format?: string }).youtube_format,
      posts_per_day: (n.data as { posts_per_day?: number }).posts_per_day,
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
  const isSocial = String(props.type ?? "").startsWith("post_");
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
              : isSocial
                ? "border-sky-500/55 ring-1 ring-sky-500/20"
                : "border-border",
        )}
      >
        <div className="flex items-center gap-1 font-medium text-foreground">
          {isSchedule ? (
            <Clock className="size-3 shrink-0 text-violet-600 dark:text-violet-400" />
          ) : isSendEmail ? (
            <Mail className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
          ) : isSocial ? (
            <Share2 className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />
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
  post_facebook: WfEditNode,
  post_instagram: WfEditNode,
  post_linkedin: WfEditNode,
  post_whatsapp: WfEditNode,
  post_x: WfEditNode,
  post_twitter: WfEditNode,
  post_youtube: WfEditNode,
};

// ── Tipos ──────────────────────────────────────────────────────────────────────

type WfMode = "exec" | "edit";

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
  workflow, running, wfMode,
  onRunNow, onEdit, onDelete, onExitEdit,
  onToggleWorkflowSchedule, workflowScheduleToggleBusy,
}: {
  workflow: WorkflowDTO;
  running: boolean;
  wfMode?: WfMode;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExitEdit?: () => void;
  onToggleWorkflowSchedule?: () => void;
  workflowScheduleToggleBusy?: boolean;
}) {
  const name = workflow.title;
  const cron = workflow.schedule_cron;
  const tz = workflow.schedule_timezone;
  const isActive = workflow.schedule_enabled;

  return (
    <div className="flex shrink-0 flex-wrap items-start gap-3 border-b border-border bg-card/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{name}</h2>
          <Badge variant="secondary" className="text-[10px]">workflow</Badge>
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
            {cron && String(cron).trim() !== "" && onToggleWorkflowSchedule ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={onToggleWorkflowSchedule}
                disabled={Boolean(workflowScheduleToggleBusy) || running}
              >
                {workflowScheduleToggleBusy ? (
                  <><Loader2 className="size-3 animate-spin" />A actualizar…</>
                ) : workflow.schedule_enabled ? (
                  <><PowerOff className="size-3" />Pausar agendamento</>
                ) : (
                  <><Power className="size-3" />Retomar agendamento</>
                )}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onEdit}>
              <Pencil className="size-3" />
              Editar
            </Button>
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
                    {wfGraphNodes.some((n) => n.type === "llm" || n.type === "web_search" || String(n.type ?? "").startsWith("post_")) ? (
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
                            .filter((n) => n.type === "llm" || n.type === "web_search" || String(n.type ?? "").startsWith("post_"))
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

              {/* Redes sociais (post_*) */}
              {["post_facebook", "post_instagram"].includes(nodeType) ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Publicação via Meta. Use{" "}
                    <code className="rounded bg-muted px-0.5">{"{{previous}}"}</code> após um nó LLM para usar o texto gerado como legenda.
                  </p>
                  <Textarea
                    placeholder="Legenda / caption"
                    className="min-h-[72px] text-xs"
                    value={String(nd?.caption ?? "")}
                    onChange={(e) => onUpdateNodeData({ caption: e.target.value })}
                  />
                  <Input
                    placeholder="URL da imagem (opcional)"
                    className="h-8 text-xs"
                    value={String((nd as { image_url?: string })?.image_url ?? "")}
                    onChange={(e) => onUpdateNodeData({ image_url: e.target.value })}
                  />
                  <label className="text-[10px] text-muted-foreground">Publicações por dia (referência para o copy)</label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    className="h-8 text-xs"
                    value={String((nd as { posts_per_day?: number })?.posts_per_day ?? 1)}
                    onChange={(e) => onUpdateNodeData({ posts_per_day: Number(e.target.value) || 1 })}
                  />
                </div>
              ) : null}

              {nodeType === "post_whatsapp" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Número destino (formato aceite pela API Meta, ex. E.164). Mensagem em caption ou{" "}
                    <code className="rounded bg-muted px-0.5">{"{{previous}}"}</code>.
                  </p>
                  <Input
                    placeholder="whatsapp_to — ex. +351912345678"
                    className="h-8 font-mono text-[11px]"
                    value={String((nd as { whatsapp_to?: string })?.whatsapp_to ?? "")}
                    onChange={(e) => onUpdateNodeData({ whatsapp_to: e.target.value })}
                  />
                  <Textarea
                    placeholder="Texto da mensagem"
                    className="min-h-[64px] text-xs"
                    value={String(nd?.caption ?? "")}
                    onChange={(e) => onUpdateNodeData({ caption: e.target.value })}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    className="h-8 text-xs"
                    value={String((nd as { posts_per_day?: number })?.posts_per_day ?? 3)}
                    onChange={(e) => onUpdateNodeData({ posts_per_day: Number(e.target.value) || 1 })}
                  />
                </div>
              ) : null}

              {["post_linkedin", "post_x", "post_twitter"].includes(nodeType) ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Rascunho gerado no servidor (sem API de publicação). Preencha brief em caption ou prompt; opcional: link ou vídeo de referência.
                  </p>
                  <Textarea
                    placeholder="Brief / notas (caption)"
                    className="min-h-[56px] text-xs"
                    value={String(nd?.caption ?? "")}
                    onChange={(e) => onUpdateNodeData({ caption: e.target.value })}
                  />
                  <Textarea
                    placeholder="Instruções extra para o modelo (prompt)"
                    className="min-h-[56px] text-xs"
                    value={String(nd?.prompt ?? "")}
                    onChange={(e) => onUpdateNodeData({ prompt: e.target.value })}
                  />
                  <Input
                    placeholder="Link de referência (opcional)"
                    className="h-8 text-xs"
                    value={String((nd as { link_url?: string })?.link_url ?? "")}
                    onChange={(e) => onUpdateNodeData({ link_url: e.target.value })}
                  />
                  <Input
                    placeholder="URL de vídeo de referência (opcional)"
                    className="h-8 text-xs"
                    value={String((nd as { video_url?: string })?.video_url ?? "")}
                    onChange={(e) => onUpdateNodeData({ video_url: e.target.value })}
                  />
                  <label className="text-[10px] text-muted-foreground">Meta: posts por dia</label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    className="h-8 text-xs"
                    value={String((nd as { posts_per_day?: number })?.posts_per_day ?? 1)}
                    onChange={(e) => onUpdateNodeData({ posts_per_day: Number(e.target.value) || 1 })}
                  />
                </div>
              ) : null}

              {nodeType === "post_youtube" ? (
                <div className="space-y-2 border-t border-border pt-2">
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Rascunho título/descrição/tags. Escolha Short ou vídeo longo; o cron do nó «Agendamento» define quando corre.
                  </p>
                  <Select
                    value={String((nd as { youtube_format?: string })?.youtube_format ?? "short")}
                    onValueChange={(v) => onUpdateNodeData({ youtube_format: v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">Shorts</SelectItem>
                      <SelectItem value="long">Vídeo longo</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Brief do vídeo (caption) ou {{previous}}"
                    className="min-h-[56px] text-xs"
                    value={String(nd?.caption ?? "")}
                    onChange={(e) => onUpdateNodeData({ caption: e.target.value })}
                  />
                  <Textarea
                    placeholder="Instruções ao modelo (prompt)"
                    className="min-h-[56px] text-xs"
                    value={String(nd?.prompt ?? "")}
                    onChange={(e) => onUpdateNodeData({ prompt: e.target.value })}
                  />
                  <Input
                    placeholder="Link relacionado (opcional)"
                    className="h-8 text-xs"
                    value={String((nd as { link_url?: string })?.link_url ?? "")}
                    onChange={(e) => onUpdateNodeData({ link_url: e.target.value })}
                  />
                  <Input
                    placeholder="URL do vídeo no YouTube (opcional)"
                    className="h-8 text-xs"
                    value={String((nd as { video_url?: string })?.video_url ?? "")}
                    onChange={(e) => onUpdateNodeData({ video_url: e.target.value })}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    className="h-8 text-xs"
                    value={String((nd as { posts_per_day?: number })?.posts_per_day ?? 1)}
                    onChange={(e) => onUpdateNodeData({ posts_per_day: Number(e.target.value) || 1 })}
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

// ── Página principal ───────────────────────────────────────────────────────────

export function AutomacaoPage() {
  const { token } = useAuth();

  // ── Dados ─────────────────────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState<WorkflowDTO[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Selecção ─────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);

  // ── Execução ─────────────────────────────────────────────────────────────────
  const [runningId, setRunningId] = useState<string | null>(null);

  // ── Histórico de runs (workflows) ─────────────────────────────────────────────
  const [wfRuns, setWfRuns] = useState<WorkflowRunDTO[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);


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
      const wfs = await wf.fetchWorkflows(token);
      if (!mountedRef.current) return;
      setWorkflows(wfs);
    } catch (e) {
      if (mountedRef.current) setGlobalError(String(e));
    } finally {
      if (mountedRef.current) setLoadingAll(false);
    }
  }, [token]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Carregar runs quando workflow seleccionado (em modo exec)
  useEffect(() => {
    if (!token || !selected) {
      setWfRuns([]);
      return;
    }
    const id = selected;
    setLoadingRuns(true);
    wf.fetchWorkflowRuns(token, id)
      .then((runs) => { if (mountedRef.current) setWfRuns(runs); })
      .catch(() => { if (mountedRef.current) setWfRuns([]); })
      .finally(() => { if (mountedRef.current) setLoadingRuns(false); });
  }, [token, selected]);

  // ── Execução ─────────────────────────────────────────────────────────────────

  const handleRunNow = useCallback(async () => {
    if (!token || !selected || runningId) return;
    const id = selected;
    setRunningId(id);
    try {
      const run = await wf.runWorkflow(token, id);
      if (mountedRef.current) setWfRuns((prev) => [run, ...prev.slice(0, 4)]);
    } catch (e) {
      if (mountedRef.current) setGlobalError(String(e));
    } finally {
      if (mountedRef.current) setRunningId(null);
    }
  }, [token, selected, runningId]);


  // ── Apagar ────────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!token || !selected) return;
    if (!confirm("Apagar esta automação?")) return;
    try {
      await wf.deleteWorkflow(token, selected);
      setWorkflows((prev) => prev.filter((w) => w.id !== selected));
      setWfMode("exec");
      setSelected(null);
    } catch (e) {
      setGlobalError(String(e));
    }
  }, [token, selected]);


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
    } catch (e) {
      setGlobalError(String(e));
    }
  }, [token, setWfNodes, setWfEdges]);

  const applyWorkflowTemplate = useCallback(
    (key: WorkflowTemplateKey) => {
      const g = workflowTemplateGraph(key);
      const { nodes: ns, edges: es } = graphToFlow(g);
      setWfNodes(ns);
      setWfEdges(es);
      setWfTitle(TEMPLATE_TITLES[key]);
      setWfEditorId(null);
      setWfSelNodeId(null);
      setWfError(null);
      setGenPrompt("");
      setRecording("");
      setWfMode("edit");
      setSelected(null);
    },
    [setWfNodes, setWfEdges],
  );

  /** Pausa ou retoma o agendamento (primeiro nó schedule no grafo). */
  const toggleWorkflowSchedule = useCallback(async () => {
    if (!token || !selected) return;
    const wid = selected;
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
        setSelected(created.id);
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

  const selectedWorkflow = selected ? workflows.find((w) => w.id === selected) ?? null : null;
  const isRunning = runningId !== null && runningId === selected;
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
          <span>{scheduledWorkflows.length} com agendamento activo</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => void loadAll()} title="Actualizar">
            <RefreshCw className={cn("size-3.5", loadingAll && "animate-spin")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              nativeButton
              render={
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]">
                  <Plus className="size-3" />
                  Modelos
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="max-h-[min(70vh,360px)] w-[220px] overflow-y-auto">
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("email")}>E-mail agendado</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("facebook")}>Facebook</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("instagram")}>Instagram</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("linkedin")}>LinkedIn (rascunho)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("whatsapp")}>WhatsApp</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("x")}>X (Twitter)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("youtube_short")}>YouTube Shorts</DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyWorkflowTemplate("youtube_long")}>YouTube vídeo longo</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                          isSelected={selected === wfItem.id}
                          isRunning={runningId === wfItem.id}
                          lastRun={selected === wfItem.id ? lastWfRun : null}
                          onSelect={() => {
                            setSelected(wfItem.id);
                            setWfMode("exec");
                          }}
                          onDelete={() => {
                            setSelected(wfItem.id);
                            void handleDelete();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {workflows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <Workflow className="size-8 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">Sem workflows</p>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => applyWorkflowTemplate("email")}>
                      Modelo e-mail
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
              {selected && selectedWorkflow ? (
                <DetailHeader
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
          !selected ? (
            /* Estado vazio */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/40">
                <Zap className="size-8 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Seleccione um workflow</p>
                <p className="mt-1 text-xs text-muted-foreground/60 max-w-xs">
                  Clique num workflow na lista para ver o grafo de execução e o histórico de runs.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={newWfDraft} className="gap-1.5">
                  <Workflow className="size-3" />
                  Novo workflow
                </Button>
              </div>
            </div>
          ) : selected && selectedWorkflow ? (
            <>
              {/* Cabeçalho do item seleccionado */}
              <DetailHeader
                workflow={selectedWorkflow}
                running={isRunning}
                wfMode="exec"
                onRunNow={() => void handleRunNow()}
                onEdit={() => void loadWfForEdit(selectedWorkflow.id)}
                onDelete={() => void handleDelete()}
                onToggleWorkflowSchedule={() => void toggleWorkflowSchedule()}
                workflowScheduleToggleBusy={wfScheduleToggleBusy}
              />

              {/* Grafo visual + histórico */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Grafo */}
                <div
                  className="relative min-h-0 flex-1 overflow-hidden border-b border-border bg-muted/5"
                  style={{ minHeight: "180px" }}
                >
                  <AutomacaoWorkflowFlow
                    workflow={selectedWorkflow}
                    lastRun={lastWfRun}
                    running={isRunning}
                  />

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
                      <AutomacaoRunHistory wfRuns={wfRuns} running={isRunning} loadingRuns={loadingRuns} />
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
        ) : null}
      </div>
    </div>
  );
}
