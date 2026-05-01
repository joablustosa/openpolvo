import { Code2, MessageCircle, PanelRightClose } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { useHomeChatControls } from "@/core/HomeChatContext";
import { useAppLaunch } from "@/hooks/useAppLaunch";

type Props = {
  /** Quando definido, o botão oculta o painel direito (layout a largura completa no chat). */
  onCollapseRightPanel?: () => void;
};

/**
 * Estado vazio do painel direito (sem plugin ou dashboard activo).
 * Evita a sensação de «tela branca» à direita na home.
 */
export function WorkspaceRightEmptyState({ onCollapseRightPanel }: Props) {
  const { openPlugin } = useAppLaunch();
  const { requestNewChat } = useHomeChatControls();
  const { token } = useAuth();

  return (
    <section
      className="flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-auto bg-muted/30 p-6 text-center"
      aria-label="Área de trabalho"
    >
      <div className="max-w-md space-y-3">
        <p className="text-sm font-medium text-foreground">Área de trabalho</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          O chat fica à esquerda; aqui pode abrir integrações e o ambiente de código ao lado da
          conversa.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="gap-2"
          onClick={() => openPlugin("polvo_code")}
        >
          <Code2 className="size-4" />
          Abrir Polvo Code
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => requestNewChat()}
          title={
            token
              ? "Limpa e inicia novo estado de conversa"
              : "Repor conversa visitante"
          }
        >
          <MessageCircle className="size-4" />
          Nova conversa
        </Button>
        {onCollapseRightPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={onCollapseRightPanel}
          >
            <PanelRightClose className="size-4" />
            Ocultar painel
          </Button>
        ) : null}
      </div>
    </section>
  );
}
