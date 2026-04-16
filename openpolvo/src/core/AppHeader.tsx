import { LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { cn } from "@/lib/utils";

type Props = {
  variant: "home" | "workspace";
};

export function AppHeader({ variant }: Props) {
  const navigate = useNavigate();
  const { logout } = useAuth();

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
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => navigate("/settings/email")}
              className="text-sm"
            >
              Correio (SMTP)
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
