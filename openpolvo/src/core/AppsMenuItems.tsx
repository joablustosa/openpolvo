import {
  Bus,
  Camera,
  Globe2,
  Home,
  Mail,
  MessageCircle,
  Navigation,
  Share2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { APP_LABELS, PLUGIN_IDS, type AppId } from "@/config/apps";
import { useWorkspace } from "@/core/WorkspaceContext";
import { useAppLaunch } from "@/hooks/useAppLaunch";

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

type Props = {
  onNavigate?: () => void;
};

export function AppsMenuItems({ onNavigate }: Props) {
  const { activeApp } = useWorkspace();
  const { openPlugin, goHome } = useAppLaunch();

  return (
    <>
      <DropdownMenuLabel className="text-xs">Aplicativos</DropdownMenuLabel>
      <DropdownMenuItem
        onClick={() => {
          goHome();
          onNavigate?.();
        }}
        className="gap-2"
      >
        <Home className="size-4 opacity-80" />
        Início
        {activeApp === null ? (
          <span className="ml-auto text-[10px] text-muted-foreground">ativo</span>
        ) : null}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs">Plugins</DropdownMenuLabel>
      <div className="max-h-[min(60vh,320px)] overflow-y-auto">
        {PLUGIN_IDS.map((id) => {
          const Icon = PLUGIN_ICON[id];
          return (
            <DropdownMenuItem
              key={id}
              onClick={() => {
                openPlugin(id);
                onNavigate?.();
              }}
              className="gap-2"
            >
              <Icon className="size-4 opacity-80" />
              {APP_LABELS[id]}
              {activeApp === id ? (
                <span className="ml-auto text-[10px] text-muted-foreground">ativo</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </div>
    </>
  );
}
