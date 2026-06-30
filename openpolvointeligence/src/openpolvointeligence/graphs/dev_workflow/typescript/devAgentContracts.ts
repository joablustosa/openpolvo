"""Contratos TypeScript (espelho) — ver polvocode openpolvoBackendProtocol.ts."""

export interface DevAgentEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface DevAgentThread {
  thread_id: string;
  conversation_id: string;
  project_id?: string;
}

export type DevAgentStreamEvent =
  | { type: "progress"; step: string; label: string }
  | { type: "agent_event"; event_id: string; event_type: string; payload: Record<string, unknown> }
  | { type: "file"; file: { path: string; op: string; content?: string } }
  | { type: "done"; assistant_text: string; metadata: Record<string, unknown> };
