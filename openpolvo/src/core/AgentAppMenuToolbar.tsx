import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  PanelLeft,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_LABELS, PLUGIN_IDS } from "@/config/apps";
import { useAuth } from "@/auth/AuthContext";
import { useAnonymousChat } from "@/core/AnonymousChatContext";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useHomeChatControls } from "@/core/HomeChatContext";
import { useAppLaunch } from "@/hooks/useAppLaunch";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

type Props = {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
};

export function AgentAppMenuToolbar({
  onToggleSidebar,
  sidebarCollapsed,
}: Props) {
  const navigate = useNavigate();
  const { token, logout } = useAuth();
  const { openLoginModal } = useAnonymousChat();
  const { requestNewChat } = useHomeChatControls();
  const { clearWorkspace } = useConversationWorkspace();
  const { openPlugin } = useAppLaunch();

  const [searchOpen, setSearchOpen] = useState(false);

  const newChat = () => {
    if (token) {
      clearWorkspace();
    } else {
      requestNewChat();
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Menu da aplicação"
              >
                <Menu className="size-[18px]" strokeWidth={1.75} />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Arquivo</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem onClick={() => newChat()}>
                  Nova conversa
                  <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigate("/settings")}
                >
                  Definições do agente
                  <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Plugins</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(70vh,400px)] w-56 overflow-y-auto">
                    {PLUGIN_IDS.map((id) => (
                      <DropdownMenuItem key={id} onClick={() => openPlugin(id)}>
                        {APP_LABELS[id]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                {token ? (
                  <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                    Sair
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => openLoginModal()}>
                    Entrar…
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Editar</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem disabled>Desfazer</DropdownMenuItem>
                <DropdownMenuItem disabled>Refazer</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Copiar</DropdownMenuItem>
                <DropdownMenuItem disabled>Colar</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Visualizar</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onClick={onToggleSidebar}>
                  {sidebarCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled>Tema</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Ajuda</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem disabled>Documentação</DropdownMenuItem>
                <DropdownMenuItem disabled>Atalhos de teclado</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Sobre Open Polvo</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "rounded-md text-muted-foreground hover:text-foreground",
            sidebarCollapsed && "bg-muted/60 text-foreground",
          )}
          aria-label={
            sidebarCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"
          }
          onClick={onToggleSidebar}
        >
          <PanelLeft className="size-[18px]" strokeWidth={1.75} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Pesquisar"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-[18px]" strokeWidth={1.75} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
          onClick={() => window.history.back()}
        >
          <ChevronLeft className="size-[18px]" strokeWidth={1.75} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-md text-muted-foreground hover:text-foreground"
          aria-label="Avançar"
          onClick={() => window.history.forward()}
        >
          <ChevronRight className="size-[18px]" strokeWidth={1.75} />
        </Button>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pesquisar</DialogTitle>
            <DialogDescription>
              Pesquisa em conversas e mensagens (em breve).
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Pesquisar…" autoFocus className="mt-2" />
        </DialogContent>
      </Dialog>
    </>
  );
}
