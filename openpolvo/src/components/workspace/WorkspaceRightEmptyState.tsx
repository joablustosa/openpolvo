import { LayoutTemplate, MessageCircle, PanelRightClose } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { DEV_STUDIO_NATIVE_APP_ID } from "@/config/apps";
import { useHomeChatControls } from "@/core/HomeChatContext";
import { useAppLaunch } from "@/hooks/useAppLaunch";

type Props = {
  onCollapseRightPanel?: () => void;
};

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
          O chat fica à esquerda. Para sites e apps, peça no chat — o preview abre aqui (sem código
          na conversa). Integrações como WhatsApp e Gmail estão no menu Plugins.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="gap-2"
          onClick={() => openPlugin(DEV_STUDIO_NATIVE_APP_ID)}
        >
          <LayoutTemplate className="size-4" />
          Abrir estúdio (preview)
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
