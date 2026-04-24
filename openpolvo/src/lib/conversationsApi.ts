import { fetchApi } from "./api";
import { ApiError } from "./apiErrors";

async function ensureOk(res: Response, fallbackLabel: string): Promise<void> {
  if (res.ok) return;
  const err = await res.json().catch(() => ({}));
  const parsed = (err as { error?: string }).error?.trim();
  const msg =
    parsed && parsed.length > 0 ? parsed : `${fallbackLabel} (${res.status})`;
  throw new ApiError(res.status, msg);
}

export type ModelProvider = "openai" | "google" | "auto";

export type ConversationDTO = {
  id: string;
  title?: string | null;
  default_model_provider: ModelProvider;
  pinned_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageDTO = {
  id: string;
  role: string;
  content: string;
  metadata?: unknown;
  created_at: string;
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchConversations(
  token: string,
): Promise<ConversationDTO[]> {
  const res = await fetchApi("/v1/conversations", {
    headers: headersJson(token),
  });
  await ensureOk(res, "conversas");
  return res.json() as Promise<ConversationDTO[]>;
}

export async function createConversation(
  token: string,
  body: { title?: string; default_model_provider?: ModelProvider },
): Promise<ConversationDTO> {
  const res = await fetchApi("/v1/conversations", {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  await ensureOk(res, "criar conversa");
  return res.json() as Promise<ConversationDTO>;
}

export async function fetchMessages(
  token: string,
  conversationId: string,
): Promise<MessageDTO[]> {
  const res = await fetchApi(`/v1/conversations/${conversationId}/messages`, {
    headers: headersJson(token),
  });
  await ensureOk(res, "mensagens");
  return res.json() as Promise<MessageDTO[]>;
}

export async function postMessage(
  token: string,
  conversationId: string,
  body: { text: string; model_provider?: ModelProvider; llm_profile_id?: string },
): Promise<MessageDTO[]> {
  const res = await fetchApi(`/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  await ensureOk(res, "enviar mensagem");
  return res.json() as Promise<MessageDTO[]>;
}

export async function deleteConversation(
  token: string,
  conversationId: string,
): Promise<void> {
  const res = await fetchApi(`/v1/conversations/${conversationId}`, {
    method: "DELETE",
    headers: headersJson(token),
  });
  await ensureOk(res, "eliminar conversa");
}

export async function renameConversation(
  token: string,
  conversationId: string,
  title: string,
): Promise<ConversationDTO> {
  const res = await fetchApi(`/v1/conversations/${conversationId}`, {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify({ title }),
  });
  await ensureOk(res, "renomear conversa");
  return res.json() as Promise<ConversationDTO>;
}

// ── Streaming SSE ─────────────────────────────────────────────────────────────

export type StreamEventProgress = {
  type: "progress";
  step: string;
  label: string;
};
export type StreamEventFile = {
  type: "file";
  file: { path: string; language: string; content: string };
};
export type StreamEventDone = {
  type: "done";
  assistant_text: string;
  metadata: Record<string, unknown>;
};
export type StreamEventError = {
  type: "error";
  detail: string;
};
export type StreamEventMessagesSaved = {
  type: "messages_saved";
  messages: MessageDTO[];
};
export type StreamEvent =
  | StreamEventProgress
  | StreamEventFile
  | StreamEventDone
  | StreamEventError
  | StreamEventMessagesSaved;

export async function streamMessage(
  token: string,
  conversationId: string,
  body: { text: string; model_provider?: ModelProvider; llm_profile_id?: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetchApi(
    `/v1/conversations/${conversationId}/messages/stream`,
    {
      method: "POST",
      headers: {
        ...headersJson(token),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: string }).error?.trim();
    throw new ApiError(res.status, msg && msg.length > 0 ? msg : `stream ${res.status}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        // linha malformada — ignorar
      }
    }
  }
}

export async function pinConversation(
  token: string,
  conversationId: string,
  pinned: boolean,
): Promise<ConversationDTO> {
  const res = await fetchApi(`/v1/conversations/${conversationId}/pin`, {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({ pinned }),
  });
  await ensureOk(res, "fixar conversa");
  return res.json() as Promise<ConversationDTO>;
}
