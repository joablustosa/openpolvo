import { useEffect, useRef, useState } from "react";
import { getTaskList, type TaskListDTO } from "@/lib/taskListsApi";

const TERMINAL = new Set(["completed", "failed"]);

/**
 * Faz polling a GET /v1/task-lists/{id} enquanto o estado for "running".
 * Para automaticamente quando atingir um estado terminal.
 * Re-arranca se listId ou status mudarem de volta para "running" (ex: nova execução).
 */
export function useTaskListPolling(
  listId: string | null,
  token: string | null,
  initialData?: TaskListDTO | null,
): TaskListDTO | null {
  const [data, setData] = useState<TaskListDTO | null>(initialData ?? null);
  const activeRef = useRef(false);

  useEffect(() => {
    setData(initialData ?? null);
  }, [initialData]);

  useEffect(() => {
    if (!listId || !token) return;
    if (data && TERMINAL.has(data.status)) return;

    activeRef.current = true;

    const poll = async () => {
      if (!activeRef.current) return;
      try {
        const d = await getTaskList(token, listId);
        if (!activeRef.current) return;
        setData(d);
        if (!TERMINAL.has(d.status)) {
          setTimeout(poll, 2500);
        }
      } catch {
        // falha silenciosa — o intervalo será retomado no próximo efeito
      }
    };

    void poll();

    return () => {
      activeRef.current = false;
    };
  }, [listId, token, data?.status]);

  return data;
}
