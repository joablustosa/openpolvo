import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { oficialLogoSrc } from "@/components/brand/AppLogo";
import { AppsMenuItems } from "@/core/AppsMenuItems";
import { useAuth } from "@/auth/AuthContext";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/core/WorkspaceContext";
import { cn } from "@/lib/utils";

type Props = {
  variant: "home" | "workspace";
};

export function AppHeader({ variant }: Props) {
  const { logout } = useAuth();
  const { activeApp } = useWorkspace();
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "cowork" | "code">(
    "chat",
  );

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/80 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        variant === "home" && "pl-4 pr-4",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton
            render={
              <Button variant="ghost" size="sm" className="gap-2 font-medium">
                <LayoutGrid className="size-4 opacity-90" />
                <span className="hidden sm:inline">Aplicativos</span>
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-52">
            <AppsMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>

        {variant === "workspace" && activeApp ? (
          <Tabs
            value={workspaceTab}
            onValueChange={(v) =>
              setWorkspaceTab(v as "chat" | "cowork" | "code")
            }
            className="hidden md:block"
          >
            <TabsList className="h-8 bg-muted/50">
              <TabsTrigger value="chat" className="px-3 text-xs">
                Chat
              </TabsTrigger>
              <TabsTrigger value="cowork" className="px-3 text-xs" disabled>
                Cowork
              </TabsTrigger>
              <TabsTrigger value="code" className="px-3 text-xs" disabled>
                Código
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton
            render={
              <Button variant="ghost" size="icon-sm" className="rounded-full">
                <Avatar className="size-7">
                  <AvatarImage
                    src={oficialLogoSrc}
                    alt="Open Polvo"
                    className="object-contain [image-rendering:pixelated] p-0.5"
                  />
                  <AvatarFallback className="text-[9px]">OL</AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Conta (em breve)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => logout()}
              className="text-sm"
            >
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
