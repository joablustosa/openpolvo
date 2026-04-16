import { Bell, CircleHelp, UserRound } from "lucide-react";
import { AgentAppMenuToolbar } from "@/core/AgentAppMenuToolbar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthContext";
import { useAnonymousChat } from "@/core/AnonymousChatContext";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function AgentHomeHeader({ sidebarCollapsed, onToggleSidebar }: Props) {
  const { token, logout } = useAuth();
  const { openLoginModal } = useAnonymousChat();

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-3">
      <AgentAppMenuToolbar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
      <div className="flex min-w-0 flex-1 justify-end">
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label="Notificações"
            disabled
          >
            <Bell className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label="Ajuda"
            disabled
          >
            <CircleHelp className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              nativeButton
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-muted-foreground"
                  aria-label="Conta"
                >
                  <UserRound className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              {token ? (
                <>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    Sessão iniciada
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                    Sair
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => openLoginModal()}>Entrar</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
