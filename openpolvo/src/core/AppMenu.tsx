import {
  Bus,
  Camera,
  Globe2,
  Home,
  Mail,
  MessageCircle,
  Navigation,
  PanelLeftClose,
  PanelLeft,
  Settings2,
  Share2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { APP_LABELS, PLUGIN_IDS, type AppId } from "@/config/apps";
import { useAuth } from "@/auth/AuthContext";
import { useWorkspace } from "@/core/WorkspaceContext";
import { useAppLaunch } from "@/hooks/useAppLaunch";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const PLUGIN_ICON: Record<AppId, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Camera,
  facebook: Share2,
  gmail: Mail,
  smartbus: Bus,
  gbtech: Globe2,
  clickbus: Navigation,
  buscaonibus: Bus,
};

export function AppMenu() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { activeApp, sidebarCollapsed, toggleSidebar } = useWorkspace();
  const { openPlugin, goHome } = useAppLaunch();

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-[52px]" : "w-[220px]",
      )}
      aria-label="Navegação do workspace"
    >
      <div
        className={cn(
          "flex h-12 items-center gap-1 border-b border-sidebar-border px-2",
          sidebarCollapsed && "justify-center",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-sidebar-foreground/90"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-label={
            sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"
          }
        >
          {sidebarCollapsed ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
        {!sidebarCollapsed ? (
          <span className="truncate text-sm font-semibold tracking-tight">
            Open Polvo
          </span>
        ) : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        <p
          className={cn(
            "px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
            sidebarCollapsed && "sr-only",
          )}
        >
          Aplicativos
        </p>
        <Button
          variant={activeApp === null ? "secondary" : "ghost"}
          size="sm"
          className={cn(
            "justify-start gap-2 font-normal",
            sidebarCollapsed && "justify-center px-0",
          )}
          onClick={goHome}
        >
          <Home className="size-4 shrink-0 opacity-90" />
          {!sidebarCollapsed ? "Início" : null}
        </Button>

        <Separator className="my-2 bg-sidebar-border" />

        <p
          className={cn(
            "px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
            sidebarCollapsed && "sr-only",
          )}
        >
          Plugins
        </p>
        {PLUGIN_IDS.map((id) => {
          const Icon = PLUGIN_ICON[id];
          return (
            <Button
              key={id}
              variant={activeApp === id ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "justify-start gap-2 font-normal",
                sidebarCollapsed && "justify-center px-0",
              )}
              onClick={() => openPlugin(id)}
              title={sidebarCollapsed ? APP_LABELS[id] : undefined}
            >
              <Icon className="size-4 shrink-0 opacity-90" />
              {!sidebarCollapsed ? APP_LABELS[id] : null}
            </Button>
          );
        })}

        <Separator className="my-2 bg-sidebar-border" />

        <p
          className={cn(
            "px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
            sidebarCollapsed && "sr-only",
          )}
        >
          Agente
        </p>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "justify-start gap-2 font-normal",
            sidebarCollapsed && "justify-center px-0",
          )}
          title={sidebarCollapsed ? "Definições do agente" : undefined}
          onClick={() => navigate("/settings")}
        >
          <Settings2 className="size-4 shrink-0 opacity-90" />
          {!sidebarCollapsed ? "Definições" : null}
        </Button>
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-full border-sidebar-border bg-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            sidebarCollapsed && "px-0",
          )}
          onClick={() => logout()}
        >
          {!sidebarCollapsed ? "Sair" : "×"}
        </Button>
      </div>
    </aside>
  );
}
