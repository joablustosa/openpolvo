import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/core/WorkspaceContext";

/**
 * A rota `/agente-tarefas` abre as listas no painel direito da conversa e
 * redirecciona para `/`.
 */
export function AgenteTarefasPage() {
  const navigate = useNavigate();
  const { openTaskListsPreview } = useWorkspace();

  useEffect(() => {
    openTaskListsPreview();
    navigate("/", { replace: true });
  }, [navigate, openTaskListsPreview]);

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      A abrir listas ao lado do chat…
    </div>
  );
}
