/** Tipos SSE `agent_event` do contrato Desk MVP (CORE-5). */
export type AgentEventKind =
  | "thought"
  | "tool_call"
  | "tool_result"
  | "observation"
  | "graph_step"
  | "final";

export type AgentEventRecord = {
  id: string;
  kind: AgentEventKind;
  payload: Record<string, unknown>;
  at: number;
};

export function parseAgentEventKind(raw: string): AgentEventKind {
  const k = raw.trim().toLowerCase();
  if (
    k === "thought" ||
    k === "tool_call" ||
    k === "tool_result" ||
    k === "observation" ||
    k === "graph_step" ||
    k === "final"
  ) {
    return k;
  }
  return "graph_step";
}

export function agentEventLabel(kind: AgentEventKind): string {
  switch (kind) {
    case "thought":
      return "Pensamento";
    case "tool_call":
      return "Tool call";
    case "tool_result":
      return "Resultado";
    case "observation":
      return "Observação";
    case "graph_step":
      return "Passo";
    case "final":
      return "Final";
  }
}

export function agentEventSummary(kind: AgentEventKind, payload: Record<string, unknown>): string {
  const tool = payload.tool ?? payload.name;
  if (typeof tool === "string" && tool.trim()) {
    return tool.trim();
  }
  const text = payload.text ?? payload.message ?? payload.content ?? payload.detail;
  if (typeof text === "string" && text.trim()) {
    const t = text.trim();
    return t.length > 120 ? `${t.slice(0, 117)}…` : t;
  }
  return agentEventLabel(kind);
}
