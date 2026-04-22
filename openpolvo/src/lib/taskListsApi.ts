import { apiUrl } from "./api";

export type TaskItemDTO = {
  id: string;
  position: number;
  title: string;
  description?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  result?: string | null;
  error_msg?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type TaskListDTO = {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  items?: TaskItemDTO[];
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
};

export type CreateTaskListBody = {
  title: string;
  items: { title: string; description?: string }[];
};

function headersJson(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchTaskLists(token: string): Promise<TaskListDTO[]> {
  const res = await fetch(apiUrl("/v1/task-lists"), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`task-lists: ${res.status}`);
  return res.json() as Promise<TaskListDTO[]>;
}

export async function getTaskList(
  token: string,
  id: string,
): Promise<TaskListDTO> {
  const res = await fetch(apiUrl(`/v1/task-lists/${id}`), {
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`task-list: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export async function createTaskList(
  token: string,
  body: CreateTaskListBody,
): Promise<TaskListDTO> {
  const res = await fetch(apiUrl("/v1/task-lists"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create task-list: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export async function deleteTaskList(
  token: string,
  id: string,
): Promise<void> {
  const res = await fetch(apiUrl(`/v1/task-lists/${id}`), {
    method: "DELETE",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`delete task-list: ${res.status}`);
}

export async function runTaskList(
  token: string,
  id: string,
): Promise<TaskListDTO> {
  const res = await fetch(apiUrl(`/v1/task-lists/${id}/run`), {
    method: "POST",
    headers: headersJson(token),
  });
  if (!res.ok) throw new Error(`run task-list: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export type TaskListBatchStep = {
  op: string;
  ok: boolean;
  error?: string;
  list?: unknown;
};

export type TaskListBatchResponse = {
  steps: TaskListBatchStep[];
};

/** Aplica operações devolvidas pelo agente (corpo igual ao esperado pela API Go). */
export async function applyTaskListBatch(
  token: string,
  operations: unknown[],
): Promise<TaskListBatchResponse> {
  const res = await fetch(apiUrl("/v1/task-lists/batch"), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({ operations }),
  });
  if (!res.ok) throw new Error(`task-lists batch: ${res.status}`);
  return res.json() as Promise<TaskListBatchResponse>;
}

export async function patchTaskListTitle(
  token: string,
  id: string,
  title: string,
): Promise<TaskListDTO> {
  const res = await fetch(apiUrl(`/v1/task-lists/${id}`), {
    method: "PATCH",
    headers: headersJson(token),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`patch task-list: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export async function appendTaskListItems(
  token: string,
  id: string,
  items: { title: string; description?: string }[],
): Promise<TaskListDTO> {
  const res = await fetch(apiUrl(`/v1/task-lists/${id}/items`), {
    method: "POST",
    headers: headersJson(token),
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`append task-list items: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export async function patchTaskListItem(
  token: string,
  listId: string,
  itemId: string,
  body: {
    title?: string;
    description?: string | null;
    position?: number;
    due_at?: string | null;
  },
): Promise<TaskListDTO> {
  const res = await fetch(
    apiUrl(`/v1/task-lists/${listId}/items/${itemId}`),
    {
      method: "PATCH",
      headers: headersJson(token),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`patch task item: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}

export async function deleteTaskListItem(
  token: string,
  listId: string,
  itemId: string,
): Promise<TaskListDTO> {
  const res = await fetch(
    apiUrl(`/v1/task-lists/${listId}/items/${itemId}`),
    {
      method: "DELETE",
      headers: headersJson(token),
    },
  );
  if (!res.ok) throw new Error(`delete task item: ${res.status}`);
  return res.json() as Promise<TaskListDTO>;
}
